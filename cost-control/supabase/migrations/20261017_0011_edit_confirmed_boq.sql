-- ============================================================
-- ผู้ใช้ตัดสินใจ: ฝ่ายบริหารและผู้ดูแลระบบแก้ BOQ ที่ยืนยันแล้วได้ตลอด แม้มีเอกสารต้นทุนแล้ว
-- ไม่ต้องสร้างร่างแก้ไขหรือ VO ทุกการเพิ่ม แก้ ลบ ถูกเก็บใน audit log พร้อมค่าเดิมและค่าใหม่
-- เวอร์ชันที่ถูกแทนที่แล้วยังล็อกไว้เป็นประวัติ
-- ข้อห้ามที่ยังเหลือเพื่อไม่ให้ข้อมูลเสีย:
--   1. ลบรายการที่มีเอกสารต้นทุนผูกอยู่ไม่ได้ (foreign key ปฏิเสธเอง) ให้แก้ปริมาณเป็น 0 แทน
--   2. รายการที่มีเอกสารต้นทุนผูกอยู่ แก้เป็นปริมาณติดลบ (งานลด) ไม่ได้
--   3. รายการนอก BOQ ของเวอร์ชันที่ยืนยันแล้วลบไม่ได้ เพราะเป็นที่ผูกของซื้อนอก BOQ
-- ============================================================

create or replace function public.boq_item_has_cost_documents(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.purchase_request_items where boq_item_id = p_item_id)
      or exists (select 1 from public.purchase_order_items where boq_item_id = p_item_id)
      or exists (select 1 from public.goods_receipt_items where boq_item_id = p_item_id)
      or exists (select 1 from public.expenses where boq_item_id = p_item_id)
      or exists (select 1 from public.subcontract_agreements where boq_item_id = p_item_id)
$$;

create or replace function public.boq_items_lock()
returns trigger language plpgsql as $$
declare v_status public.boq_version_status;
begin
  select status into v_status from public.boq_versions where id = coalesce(new.boq_version_id, old.boq_version_id);
  -- ไม่พบเวอร์ชันแม่ แปลว่ากำลังถูกลบทั้งเวอร์ชัน (cascade) ปล่อยผ่าน
  if v_status is null then return coalesce(new, old); end if;
  if v_status = 'draft' then return coalesce(new, old); end if;
  -- รายการนอก BOQ ที่ระบบสร้างตอนยืนยัน
  if tg_op = 'INSERT' and new.is_off_boq then return new; end if;

  if v_status = 'confirmed' and public.current_role_name() in ('management', 'admin') then
    if tg_op = 'DELETE' and old.is_off_boq then
      raise exception 'รายการนอก BOQ ลบไม่ได้ เป็นที่ผูกของซื้อนอก BOQ ของโครงการ';
    end if;
    if tg_op = 'UPDATE' and new.qty < 0 and old.qty >= 0 and public.boq_item_has_cost_documents(old.id) then
      raise exception 'รายการนี้มีเอกสารต้นทุนผูกอยู่ เปลี่ยนเป็นงานลด (ปริมาณติดลบ) ไม่ได้';
    end if;
    return coalesce(new, old);
  end if;

  if v_status = 'confirmed' then
    raise exception 'BOQ ที่ยืนยันแล้ว แก้ได้เฉพาะฝ่ายบริหารและผู้ดูแลระบบ';
  end if;
  raise exception 'BOQ เวอร์ชันนี้ถูกแทนที่แล้ว เก็บไว้เป็นประวัติ แก้ไขไม่ได้';
end $$;
