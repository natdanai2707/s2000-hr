-- ============================================================
-- โหมดบันทึกซื้อตรง (ใช้ช่วงที่มีผู้ใช้คนเดียว ก่อนเปิดให้พนักงานใช้ครบทุกขั้นตอน)
-- บันทึกการสั่งซื้อครั้งเดียว ระบบตรวจ BOQ และราคาเหมือนใบขอซื้อปกติ
-- แล้วสร้างการอนุมัติ ใบสั่งซื้อ และการรับของเต็มจำนวนให้อัตโนมัติ ต้นทุนจึงเข้าเป็นต้นทุนจริงทันที
-- เอกสารครบทุกชั้นตามเดิม เมื่อปิดโหมดนี้ภายหลัง ระบบกลับไปใช้ขั้นตอนเต็มได้โดยไม่ต้องย้ายข้อมูล
-- ============================================================

insert into public.settings (key, value) values ('direct_purchase_mode', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function public.record_direct_purchase(p_pr_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_supplier uuid;
  v_po_id uuid;
  v_gr_id uuid;
begin
  if not public.setting_bool('direct_purchase_mode', false) then
    raise exception 'ระบบไม่ได้เปิดโหมดบันทึกซื้อตรง';
  end if;
  if public.current_role_name() not in ('management', 'admin') then
    raise exception 'เฉพาะฝ่ายบริหารเท่านั้นที่บันทึกซื้อตรงได้';
  end if;

  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  -- ต้องผ่าน submit_purchase_request ก่อน เพื่อให้ตรวจเกิน BOQ เกินราคา และบังคับเหตุผลตามกติกาเดิม
  -- รับใบที่อนุมัติแล้วแต่ยังไม่ออกใบสั่งซื้อด้วย (ใบที่ค้างจากก่อนเปิดโหมดนี้) ไม่งั้นจะไม่มีทางนับเป็นต้นทุน
  if v_pr.status not in ('pending_pm', 'pending_management', 'approved') then
    raise exception 'ใบขอซื้อนี้ไม่ได้อยู่ในสถานะที่บันทึกซื้อตรงได้';
  end if;
  if exists (select 1 from public.purchase_orders where pr_id = p_pr_id and status <> 'cancelled') then
    raise exception 'ใบขอซื้อนี้ออกใบสั่งซื้อแล้ว';
  end if;

  insert into public.approvals (document_type, document_id, step, approver_id, decision, comment, created_by)
  values ('purchase_request', p_pr_id, 'direct', auth.uid(), 'approved',
          'บันทึกซื้อตรง: ข้ามขั้นตอนอนุมัติ ออกใบสั่งซื้อ และรับของ', auth.uid());
  update public.purchase_requests set status = 'approved' where id = p_pr_id;

  select supplier_id into v_supplier
    from public.purchase_request_items
   where pr_id = p_pr_id and supplier_id is not null
   order by created_at
   limit 1;

  insert into public.purchase_orders (po_no, project_id, pr_id, supplier_id, status, created_by)
  values (public.next_document_no('PO'), v_pr.project_id, p_pr_id, v_supplier, 'issued', auth.uid())
  returning id into v_po_id;

  insert into public.purchase_order_items (po_id, boq_item_id, pr_item_id, description, qty, unit, unit_price, created_by)
  select v_po_id, boq_item_id, id, description, qty, unit, unit_price, auth.uid()
    from public.purchase_request_items
   where pr_id = p_pr_id;

  update public.purchase_orders
     set total_amount = (select coalesce(sum(qty * unit_price), 0) from public.purchase_order_items where po_id = v_po_id)
   where id = v_po_id;

  -- รับของเต็มจำนวนที่ราคาเดียวกับที่สั่ง สถานะใบสั่งซื้อเปลี่ยนเป็นรับครบผ่าน trigger เดิม
  insert into public.goods_receipts (po_id, received_by, received_at, source, note, created_by)
  values (v_po_id, auth.uid(), now(), 'supplier', 'บันทึกอัตโนมัติจากการบันทึกซื้อตรง', auth.uid())
  returning id into v_gr_id;

  insert into public.goods_receipt_items (receipt_id, po_item_id, boq_item_id, qty_received, unit_cost, created_by)
  select v_gr_id, id, boq_item_id, qty, unit_price, auth.uid()
    from public.purchase_order_items
   where po_id = v_po_id;

  return v_po_id;
end;
$$;

revoke execute on function public.record_direct_purchase(uuid) from public, anon;
grant execute on function public.record_direct_purchase(uuid) to authenticated;

-- ยกเลิกรายการที่บันทึกซื้อตรงผิด: ลบการรับของอัตโนมัติ ยกเลิกใบสั่งซื้อและใบขอซื้อ ต้นทุนจริงลดลงตาม
-- ทุกแถวที่ลบและสถานะที่เปลี่ยนถูกเก็บใน audit log พร้อมเหตุผล ใช้ได้เฉพาะรายการที่ยังไม่มีใบแจ้งหนี้
create or replace function public.void_direct_purchase(p_pr_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_po_id uuid;
begin
  if public.current_role_name() not in ('management', 'admin') then
    raise exception 'เฉพาะฝ่ายบริหารเท่านั้นที่ยกเลิกรายการสั่งซื้อได้';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลที่ยกเลิก';
  end if;
  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบรายการสั่งซื้อ'; end if;
  if v_pr.status <> 'approved' or not exists (
    select 1 from public.approvals where document_type = 'purchase_request' and document_id = p_pr_id and step = 'direct'
  ) then
    raise exception 'ยกเลิกได้เฉพาะรายการที่บันทึกซื้อตรง';
  end if;

  select id into v_po_id from public.purchase_orders where pr_id = p_pr_id and status <> 'cancelled';
  if v_po_id is not null then
    if exists (select 1 from public.invoices where po_id = v_po_id) then
      raise exception 'รายการนี้มีใบแจ้งหนี้แล้ว ยกเลิกไม่ได้';
    end if;
    delete from public.goods_receipt_items where receipt_id in (select id from public.goods_receipts where po_id = v_po_id);
    delete from public.goods_receipts where po_id = v_po_id;
    update public.purchase_orders set status = 'cancelled' where id = v_po_id;
  end if;

  insert into public.approvals (document_type, document_id, step, approver_id, decision, comment, created_by)
  values ('purchase_request', p_pr_id, 'direct_void', auth.uid(), 'rejected', p_reason, auth.uid());
  update public.purchase_requests set status = 'cancelled' where id = p_pr_id;
end;
$$;

revoke execute on function public.void_direct_purchase(uuid, text) from public, anon;
grant execute on function public.void_direct_purchase(uuid, text) to authenticated;
