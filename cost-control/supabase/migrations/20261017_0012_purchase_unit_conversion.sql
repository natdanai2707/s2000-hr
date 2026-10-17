-- ============================================================
-- ซื้อเป็นหน่วยอื่นจาก BOQ เช่น BOQ คิดเหล็กเป็นกิโล แต่ซื้อเป็นเส้น
-- ใบขอซื้อ ใบสั่งซื้อ และการรับของ เก็บปริมาณและราคาตามหน่วยที่ซื้อจริง ยอดเงินจึงตรงทุกสตางค์
-- qty_factor = จำนวนหน่วย BOQ ต่อหนึ่งหน่วยที่ซื้อ (เช่น 1 เส้น = 299.4 kg) ค่าเริ่มต้น 1 = หน่วยเดียวกัน
-- การเทียบกับ BOQ ทั้งปริมาณ (เกิน BOQ) และราคา (แพงกว่าต้นทุน) แปลงเป็นหน่วย BOQ ก่อนเสมอ
-- ============================================================

alter table public.purchase_request_items
  add column if not exists qty_factor numeric(18,6) not null default 1 check (qty_factor > 0);
alter table public.purchase_order_items
  add column if not exists qty_factor numeric(18,6) not null default 1 check (qty_factor > 0);

create or replace function public.submit_purchase_request(p_pr_id uuid)
returns public.pr_status language plpgsql security definer set search_path = public as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_item record;
  v_threshold numeric := public.setting_numeric('price_variance_threshold_pct', 5);
  v_limit numeric := public.setting_numeric('pm_approval_limit', 50000);
  v_qty_rule boolean := public.setting_bool('qty_over_boq_requires_management', true);
  v_total numeric := 0;
  v_any_over boolean := false;
  v_ordered numeric;
begin
  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  -- เจ้าของ, PM/management ของโครงการ หรือ purchasing (กรณีแก้ราคาตอนออก PO แล้วต้องส่งกลับไปอนุมัติใหม่)
  if v_pr.requested_by <> auth.uid() and not public.can_manage_project(v_pr.project_id)
     and public.current_role_name() <> 'purchasing' then
    raise exception 'ไม่มีสิทธิ์ส่งใบขอซื้อนี้';
  end if;
  if v_pr.status not in ('draft', 'rejected') then raise exception 'ใบขอซื้อนี้ส่งแล้ว'; end if;
  if not exists (select 1 from public.purchase_request_items where pr_id = p_pr_id) then
    raise exception 'ใบขอซื้อไม่มีรายการ';
  end if;

  for v_item in
    select pri.id, pri.qty, pri.unit_price, pri.qty_factor, pri.variance_reason, b.qty as boq_qty, b.unit_cost, b.is_off_boq
      from public.purchase_request_items pri
      join public.boq_items b on b.id = pri.boq_item_id
     where pri.pr_id = p_pr_id
  loop
    -- ปริมาณที่สั่งแล้ว (PO ที่ไม่ยกเลิก) + PR อื่นที่กำลังรอ/อนุมัติแล้วแต่ยังไม่เป็น PO
    select coalesce(sum(poi.qty * poi.qty_factor), 0) into v_ordered
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
     where poi.boq_item_id = (select boq_item_id from public.purchase_request_items where id = v_item.id)
       and po.status <> 'cancelled';

    declare
      v_over_qty boolean := (not v_item.is_off_boq) and (v_ordered + v_item.qty * v_item.qty_factor > v_item.boq_qty);
      v_over_price boolean := (not v_item.is_off_boq) and v_item.boq_qty > 0
                              and v_item.unit_price / v_item.qty_factor > v_item.unit_cost * (1 + v_threshold / 100);
    begin
      if (v_over_qty or v_over_price or v_item.is_off_boq) and coalesce(trim(v_item.variance_reason), '') = '' then
        raise exception 'ต้องระบุเหตุผลสำหรับรายการที่เกิน BOQ หรือเกินราคาที่ทดไว้';
      end if;
      update public.purchase_request_items
         set qty_over_boq = v_over_qty, price_over_threshold = v_over_price
       where id = v_item.id;
      if v_over_qty or v_item.is_off_boq then v_any_over := true; end if;
    end;
    v_total := v_total + v_item.qty * v_item.unit_price;
  end loop;

  update public.purchase_requests
     set total_amount = v_total,
         requires_management = (v_total > v_limit) or (v_qty_rule and v_any_over),
         status = 'pending_pm',
         submitted_at = now()
   where id = p_pr_id;

  return 'pending_pm';
end $$;

create or replace function public.create_po_from_pr(p_pr_id uuid, p_supplier_id uuid, p_prices jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_threshold numeric := public.setting_numeric('price_variance_threshold_pct', 5);
  v_po_id uuid;
  v_total numeric := 0;
  v_item record;
  v_price numeric;
  v_needs_reapproval boolean := false;
begin
  if public.current_role_name() not in ('purchasing', 'management') then
    raise exception 'เฉพาะฝ่ายจัดซื้อเท่านั้นที่ออก PO ได้';
  end if;
  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  if v_pr.status <> 'approved' then raise exception 'ใบขอซื้อยังไม่ได้รับอนุมัติ'; end if;
  if exists (select 1 from public.purchase_orders where pr_id = p_pr_id and status <> 'cancelled') then
    raise exception 'ใบขอซื้อนี้ออก PO แล้ว';
  end if;

  -- ตรวจราคาที่แก้
  for v_item in select id, unit_price from public.purchase_request_items where pr_id = p_pr_id loop
    select (e ->> 'unit_price')::numeric into v_price
      from jsonb_array_elements(p_prices) e where (e ->> 'pr_item_id')::uuid = v_item.id;
    if v_price is not null and v_price > v_item.unit_price * (1 + v_threshold / 100) then
      v_needs_reapproval := true;
    end if;
  end loop;

  if v_needs_reapproval then
    for v_item in select id from public.purchase_request_items where pr_id = p_pr_id loop
      select (e ->> 'unit_price')::numeric into v_price
        from jsonb_array_elements(p_prices) e where (e ->> 'pr_item_id')::uuid = v_item.id;
      if v_price is not null then
        update public.purchase_request_items
           set unit_price = v_price,
               variance_reason = coalesce(variance_reason, 'ฝ่ายจัดซื้อแก้ราคาตอนออก PO')
         where id = v_item.id;
      end if;
    end loop;
    update public.purchase_requests set status = 'draft' where id = p_pr_id;
    perform public.submit_purchase_request(p_pr_id);
    return null;
  end if;

  insert into public.purchase_orders (po_no, project_id, pr_id, supplier_id, status, created_by)
  values (public.next_document_no('PO'), v_pr.project_id, p_pr_id, p_supplier_id, 'issued', auth.uid())
  returning id into v_po_id;

  for v_item in select * from public.purchase_request_items where pr_id = p_pr_id loop
    select (e ->> 'unit_price')::numeric into v_price
      from jsonb_array_elements(p_prices) e where (e ->> 'pr_item_id')::uuid = v_item.id;
    v_price := coalesce(v_price, v_item.unit_price);
    insert into public.purchase_order_items (po_id, boq_item_id, pr_item_id, description, qty, unit, unit_price, qty_factor, created_by)
    values (v_po_id, v_item.boq_item_id, v_item.id, v_item.description, v_item.qty, v_item.unit, v_price, v_item.qty_factor, auth.uid());
    v_total := v_total + v_item.qty * v_price;
  end loop;

  update public.purchase_orders set total_amount = v_total where id = v_po_id;
  return v_po_id;
end $$;

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

  insert into public.purchase_order_items (po_id, boq_item_id, pr_item_id, description, qty, unit, unit_price, qty_factor, created_by)
  select v_po_id, boq_item_id, id, description, qty, unit, unit_price, qty_factor, auth.uid()
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

create or replace view public.v_boq_item_costs
with (security_invoker = true) as
with po_qty as (
  -- ปริมาณและมูลค่าที่สั่งแล้ว (PO ที่ไม่ยกเลิก) ต่อรายการ PO
  select poi.id as po_item_id, poi.boq_item_id, poi.po_id, poi.qty, poi.unit_price, poi.qty_factor
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.po_id
   where po.status <> 'cancelled'
),
gr_per_po_item as (
  select po_item_id, sum(qty_received) as qty_received, sum(qty_received * unit_cost) as amount
    from public.goods_receipt_items group by po_item_id
),
committed as (
  -- ยังไม่รับของ = (qty สั่ง − qty รับ) × ราคา PO
  select pq.boq_item_id,
         sum(greatest(pq.qty - coalesce(g.qty_received, 0), 0) * pq.unit_price) as committed,
         sum(pq.qty * pq.qty_factor) as qty_ordered
    from po_qty pq left join gr_per_po_item g on g.po_item_id = pq.po_item_id
   group by pq.boq_item_id
),
received as (
  -- ปริมาณรับเป็นหน่วยของ BOQ (คูณตัวแปลงหน่วยของรายการ PO) เงินคิดตามหน่วยที่ซื้อจริง
  select gri.boq_item_id,
         sum(gri.qty_received * coalesce(poi.qty_factor, 1)) as qty_received,
         sum(gri.qty_received * gri.unit_cost) as actual
    from public.goods_receipt_items gri
    left join public.purchase_order_items poi on poi.id = gri.po_item_id
   group by gri.boq_item_id
),
expense_sum as (
  select boq_item_id, sum(amount) as amount from public.expenses group by boq_item_id
),
wcc_sum as (
  -- งวดงานผู้รับเหมาช่วงที่รับรองแล้ว นับเป็น actual ของรายการ BOQ
  select a.boq_item_id, sum(w.amount) as amount
    from public.work_completion_certificates w
    join public.subcontract_agreements a on a.id = w.agreement_id
   where w.certified_at is not null
   group by a.boq_item_id
),
po_paid as (
  select i.po_id, sum(p.amount) as paid
    from public.invoices i join public.payments p on p.invoice_id = i.id
   where i.po_id is not null group by i.po_id
),
po_total as (
  select po_id, sum(qty * unit_price) as total from public.purchase_order_items group by po_id
),
po_item_paid as (
  -- กระจายยอดชำระของ PO ลงรายการ BOQ ตามสัดส่วนมูลค่ารายการใน PO
  select poi.boq_item_id,
         sum(pp.paid * (poi.qty * poi.unit_price) / nullif(pt.total, 0)) as paid
    from public.purchase_order_items poi
    join po_paid pp on pp.po_id = poi.po_id
    join po_total pt on pt.po_id = poi.po_id
   group by poi.boq_item_id
),
agreement_paid as (
  select a.boq_item_id, sum(p.amount) as paid
    from public.invoices i
    join public.payments p on p.invoice_id = i.id
    join public.subcontract_agreements a on a.id = i.agreement_id
   where i.agreement_id is not null
   group by a.boq_item_id
)
select b.id as boq_item_id,
       b.boq_version_id,
       v.project_id,
       b.section_id,
       b.item_no, b.description, b.unit, b.category, b.is_off_boq,
       b.qty, b.unit_cost, b.sell_unit_price,
       round(b.qty * b.unit_cost, 2) as budget,
       round(b.qty * b.sell_unit_price, 2) as sell_total,
       round(coalesce(c.committed, 0), 2) as committed,
       round(coalesce(r.actual, 0) + coalesce(e.amount, 0) + coalesce(w.amount, 0), 2) as actual,
       round(coalesce(pip.paid, 0) + coalesce(e.amount, 0) + coalesce(ap.paid, 0), 2) as paid,
       coalesce(c.qty_ordered, 0) as qty_ordered,
       coalesce(r.qty_received, 0) as qty_received,
       b.qty - coalesce(c.qty_ordered, 0) as qty_remaining
  from public.boq_items b
  join public.boq_versions v on v.id = b.boq_version_id
  left join committed c on c.boq_item_id = b.id
  left join received r on r.boq_item_id = b.id
  left join expense_sum e on e.boq_item_id = b.id
  left join wcc_sum w on w.boq_item_id = b.id
  left join po_item_paid pip on pip.boq_item_id = b.id
  left join agreement_paid ap on ap.boq_item_id = b.id;
