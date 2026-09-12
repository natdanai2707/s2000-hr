-- ============================================================
-- audit log trigger, กติกาล็อก BOQ, ฟังก์ชันธุรกิจ (security definer)
-- ============================================================

-- ---------- audit trigger ----------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_record uuid;
begin
  if tg_op = 'DELETE' then
    begin v_record := (to_jsonb(old) ->> 'id')::uuid; exception when others then v_record := null; end;
    insert into public.audit_logs (table_name, record_id, action, old_value, new_value, user_id)
    values (tg_table_name, v_record, tg_op, to_jsonb(old), null, auth.uid());
    return old;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(old) - 'updated_at' = to_jsonb(new) - 'updated_at' then
      return new;
    end if;
    begin v_record := (to_jsonb(new) ->> 'id')::uuid; exception when others then v_record := null; end;
    insert into public.audit_logs (table_name, record_id, action, old_value, new_value, user_id)
    values (tg_table_name, v_record, tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    begin v_record := (to_jsonb(new) ->> 'id')::uuid; exception when others then v_record := null; end;
    insert into public.audit_logs (table_name, record_id, action, old_value, new_value, user_id)
    values (tg_table_name, v_record, tg_op, null, to_jsonb(new), auth.uid());
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'profiles','projects','project_members','boq_versions','boq_items','purchase_requests',
    'purchase_request_items','approvals','purchase_orders','purchase_order_items','goods_receipts',
    'goods_receipt_items','subcontract_agreements','work_completion_certificates','invoices',
    'payments','expenses','settings'])
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- ---------- helper อ่าน profile ปัจจุบัน ----------
create or replace function public.current_role_name()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members where project_id = p_project_id and user_id = auth.uid()
  )
$$;

-- ดูโครงการได้: management/admin/purchasing/accounting ทุกโครงการ คนอื่นเฉพาะที่เป็นสมาชิก
create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('management','admin','purchasing','accounting')
      or public.is_project_member(p_project_id)
$$;

-- PM ของโครงการ (project_manager ที่เป็นสมาชิก) หรือ management
create or replace function public.can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('management','admin')
      or (public.current_role_name() = 'project_manager' and public.is_project_member(p_project_id))
$$;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = p_key), p_default)
$$;

-- ---------- ล็อก BOQ ที่ยืนยันแล้ว ----------
create or replace function public.boq_items_lock()
returns trigger language plpgsql as $$
declare v_status public.boq_version_status;
begin
  select status into v_status from public.boq_versions where id = coalesce(new.boq_version_id, old.boq_version_id);
  if tg_op = 'INSERT' then
    -- อนุญาตเฉพาะรายการนอก BOQ ที่ระบบสร้างตอนยืนยัน
    if v_status <> 'draft' and not new.is_off_boq then
      raise exception 'BOQ version นี้ยืนยันแล้ว แก้ไขรายการไม่ได้ ต้องสร้าง VO';
    end if;
    return new;
  end if;
  if v_status <> 'draft' then
    raise exception 'BOQ version นี้ยืนยันแล้ว แก้ไขรายการไม่ได้ ต้องสร้าง VO';
  end if;
  return coalesce(new, old);
end $$;
create trigger boq_items_lock before insert or update or delete on public.boq_items
  for each row execute function public.boq_items_lock();

create or replace function public.boq_versions_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' and new.status = 'draft' then
    raise exception 'ย้อนสถานะ BOQ ที่ยืนยันแล้วไม่ได้';
  end if;
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'BOQ version นี้ถูกแทนที่แล้ว';
  end if;
  return new;
end $$;
create trigger boq_versions_guard before update on public.boq_versions
  for each row execute function public.boq_versions_guard();

-- ห้ามผู้ใช้ทั่วไปเปลี่ยน role / is_active ของตัวเอง
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.current_role_name() <> 'admin' then
    if new.role <> old.role or new.is_active <> old.is_active or new.branch_id is distinct from old.branch_id then
      raise exception 'เฉพาะ admin เท่านั้นที่แก้บทบาทหรือสาขาได้';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- ยืนยัน BOQ (management เท่านั้น) ----------
create or replace function public.confirm_boq_version(p_version_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_version public.boq_versions%rowtype;
  v_prev_id uuid;
  v_item record;
  v_new_id uuid;
begin
  if public.current_role_name() not in ('management') then
    raise exception 'เฉพาะฝ่ายบริหารเท่านั้นที่ยืนยัน BOQ ได้';
  end if;
  select * into v_version from public.boq_versions where id = p_version_id for update;
  if not found then raise exception 'ไม่พบ BOQ version'; end if;
  if v_version.status <> 'draft' then raise exception 'BOQ version นี้ไม่ได้อยู่ในสถานะร่าง'; end if;
  if not exists (select 1 from public.boq_items where boq_version_id = p_version_id) then
    raise exception 'BOQ ไม่มีรายการ';
  end if;

  select id into v_prev_id from public.boq_versions
   where project_id = v_version.project_id and status = 'confirmed';

  -- version เก่าเป็น superseded ก่อน (มี partial unique index)
  if v_prev_id is not null then
    update public.boq_versions set status = 'superseded' where id = v_prev_id;
    -- ย้ายเอกสารต้นทุนที่อ้างรายการเดิมมาอ้างรายการใน version ใหม่ (ผ่าน origin_item_id)
    for v_item in
      select n.id as new_id, n.origin_item_id as old_id
        from public.boq_items n
       where n.boq_version_id = p_version_id and n.origin_item_id is not null
    loop
      update public.purchase_request_items set boq_item_id = v_item.new_id where boq_item_id = v_item.old_id;
      update public.purchase_order_items set boq_item_id = v_item.new_id where boq_item_id = v_item.old_id;
      update public.goods_receipt_items set boq_item_id = v_item.new_id where boq_item_id = v_item.old_id;
      update public.expenses set boq_item_id = v_item.new_id where boq_item_id = v_item.old_id;
      update public.subcontract_agreements set boq_item_id = v_item.new_id where boq_item_id = v_item.old_id;
    end loop;
  end if;

  -- รายการพิเศษ "นอก BOQ" ต่อโครงการ (สร้างถ้ายังไม่มีใน version นี้)
  if not exists (select 1 from public.boq_items where boq_version_id = p_version_id and is_off_boq) then
    insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category,
                                  markup_pct, sell_unit_price, sort_order, is_off_boq, created_by)
    values (p_version_id, 'OFF', 'นอก BOQ', 'รายการ', 0, 0, 'other', 0, 0, 999999, true, auth.uid());
  end if;

  update public.boq_versions
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         type = case when type = 'quotation' then 'confirmed'::public.boq_version_type else type end
   where id = p_version_id;

  update public.projects set status = 'active'
   where id = v_version.project_id and status = 'draft';
end $$;

-- ---------- สร้าง VO: copy รายการทั้งหมดจาก version ที่ confirmed ----------
create or replace function public.create_variation_order(p_project_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_src public.boq_versions%rowtype;
  v_new_id uuid;
  v_next_no integer;
  v_sec record;
  v_sec_map jsonb := '{}'::jsonb;
  v_new_sec uuid;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'ไม่มีสิทธิ์สร้าง VO ในโครงการนี้';
  end if;
  select * into v_src from public.boq_versions where project_id = p_project_id and status = 'confirmed';
  if not found then raise exception 'โครงการยังไม่มี BOQ ที่ยืนยัน'; end if;
  select coalesce(max(version_no), 0) + 1 into v_next_no from public.boq_versions where project_id = p_project_id;

  insert into public.boq_versions (project_id, version_no, type, status, note, created_by)
  values (p_project_id, v_next_no, 'variation_order', 'draft', p_note, auth.uid())
  returning id into v_new_id;

  for v_sec in select * from public.boq_sections where boq_version_id = v_src.id order by sort_order loop
    insert into public.boq_sections (boq_version_id, code, name, sort_order, created_by)
    values (v_new_id, v_sec.code, v_sec.name, v_sec.sort_order, auth.uid())
    returning id into v_new_sec;
    v_sec_map := v_sec_map || jsonb_build_object(v_sec.id::text, v_new_sec::text);
  end loop;

  insert into public.boq_items (boq_version_id, section_id, item_no, description, unit, qty, unit_cost,
                                category, markup_pct, sell_unit_price, sort_order, is_off_boq, origin_item_id, created_by)
  select v_new_id,
         case when i.section_id is null then null else (v_sec_map ->> i.section_id::text)::uuid end,
         i.item_no, i.description, i.unit, i.qty, i.unit_cost, i.category, i.markup_pct, i.sell_unit_price,
         i.sort_order, i.is_off_boq, i.id, auth.uid()
    from public.boq_items i where i.boq_version_id = v_src.id;

  return v_new_id;
end $$;

-- ---------- ใบขอซื้อ: ส่งอนุมัติ (คำนวณ flag และ routing ที่ DB) ----------
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
    select pri.id, pri.qty, pri.unit_price, pri.variance_reason, b.qty as boq_qty, b.unit_cost, b.is_off_boq
      from public.purchase_request_items pri
      join public.boq_items b on b.id = pri.boq_item_id
     where pri.pr_id = p_pr_id
  loop
    -- ปริมาณที่สั่งแล้ว (PO ที่ไม่ยกเลิก) + PR อื่นที่กำลังรอ/อนุมัติแล้วแต่ยังไม่เป็น PO
    select coalesce(sum(poi.qty), 0) into v_ordered
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
     where poi.boq_item_id = (select boq_item_id from public.purchase_request_items where id = v_item.id)
       and po.status <> 'cancelled';

    declare
      v_over_qty boolean := (not v_item.is_off_boq) and (v_ordered + v_item.qty > v_item.boq_qty);
      v_over_price boolean := (not v_item.is_off_boq) and v_item.boq_qty > 0
                              and v_item.unit_price > v_item.unit_cost * (1 + v_threshold / 100);
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

-- ---------- ใบขอซื้อ: อนุมัติ / ปฏิเสธ ----------
create or replace function public.decide_purchase_request(p_pr_id uuid, p_decision public.approval_decision, p_comment text)
returns public.pr_status language plpgsql security definer set search_path = public as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_role public.user_role := public.current_role_name();
  v_step text;
  v_next public.pr_status;
begin
  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_comment), '') = '' then
    raise exception 'ต้องระบุเหตุผลเมื่อปฏิเสธ';
  end if;

  if v_pr.status = 'pending_pm' then
    v_step := 'pm';
    if not (v_role = 'management' or (v_role = 'project_manager' and public.is_project_member(v_pr.project_id))) then
      raise exception 'เฉพาะผู้จัดการโครงการหรือฝ่ายบริหารเท่านั้นที่อนุมัติขั้นนี้ได้';
    end if;
    if p_decision = 'rejected' then v_next := 'rejected';
    elsif v_pr.requires_management and v_role <> 'management' then v_next := 'pending_management';
    else v_next := 'approved';
    end if;
  elsif v_pr.status = 'pending_management' then
    v_step := 'management';
    if v_role <> 'management' then
      raise exception 'เฉพาะฝ่ายบริหารเท่านั้นที่อนุมัติขั้นนี้ได้';
    end if;
    v_next := case when p_decision = 'approved' then 'approved'::public.pr_status else 'rejected'::public.pr_status end;
  else
    raise exception 'ใบขอซื้อนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
  end if;

  insert into public.approvals (document_type, document_id, step, approver_id, decision, comment, created_by)
  values ('purchase_request', p_pr_id, v_step, auth.uid(), p_decision, p_comment, auth.uid());

  update public.purchase_requests set status = v_next where id = p_pr_id;
  return v_next;
end $$;

-- ---------- PO: สร้างจาก PR ที่อนุมัติ (purchasing) ----------
-- p_prices: jsonb array [{pr_item_id, unit_price}] ถ้าแก้ราคาแพงขึ้นเกิน threshold
-- จะไม่สร้าง PO แต่ปรับราคาใน PR แล้วส่งกลับไปอนุมัติใหม่ คืนค่า null
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
    insert into public.purchase_order_items (po_id, boq_item_id, pr_item_id, description, qty, unit, unit_price, created_by)
    values (v_po_id, v_item.boq_item_id, v_item.id, v_item.description, v_item.qty, v_item.unit, v_price, auth.uid());
    v_total := v_total + v_item.qty * v_price;
  end loop;

  update public.purchase_orders set total_amount = v_total where id = v_po_id;
  return v_po_id;
end $$;

-- ---------- รับของ: อัปเดตสถานะ PO อัตโนมัติ ----------
create or replace function public.refresh_po_status(p_po_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_all_received boolean;
  v_any_received boolean;
begin
  select bool_and(coalesce(r.qty, 0) >= poi.qty), bool_or(coalesce(r.qty, 0) > 0)
    into v_all_received, v_any_received
    from public.purchase_order_items poi
    left join (
      select po_item_id, sum(qty_received) qty from public.goods_receipt_items group by po_item_id
    ) r on r.po_item_id = poi.id
   where poi.po_id = p_po_id;

  update public.purchase_orders
     set status = case when v_all_received then 'received'::public.po_status
                       when v_any_received then 'partially_received'::public.po_status
                       else 'issued'::public.po_status end
   where id = p_po_id and status <> 'cancelled';
end $$;

create or replace function public.goods_receipt_items_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_po uuid;
begin
  select po_id into v_po from public.goods_receipts where id = coalesce(new.receipt_id, old.receipt_id);
  perform public.refresh_po_status(v_po);
  return coalesce(new, old);
end $$;
create trigger goods_receipt_items_after after insert or update or delete on public.goods_receipt_items
  for each row execute function public.goods_receipt_items_after();

-- ---------- ชำระเงิน: อัปเดตสถานะ invoice ----------
create or replace function public.payments_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
        v_paid numeric; v_amount numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = v_inv;
  select amount into v_amount from public.invoices where id = v_inv;
  update public.invoices
     set status = case when v_paid >= v_amount then 'paid'::public.invoice_status
                       when status = 'paid' then 'approved'::public.invoice_status
                       else status end
   where id = v_inv;
  return coalesce(new, old);
end $$;
create trigger payments_after after insert or update or delete on public.payments
  for each row execute function public.payments_after();

-- ---------- จำนวนรายการรออนุมัติของผู้ใช้ปัจจุบัน (bottom nav) ----------
create or replace function public.pending_approval_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.purchase_requests pr
   where (pr.status = 'pending_pm' and (public.current_role_name() = 'management'
            or (public.current_role_name() = 'project_manager' and public.is_project_member(pr.project_id))))
      or (pr.status = 'pending_management' and public.current_role_name() = 'management')
$$;
