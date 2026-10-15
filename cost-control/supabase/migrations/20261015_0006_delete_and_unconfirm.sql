-- ============================================================
-- ให้ฝ่ายบริหารแก้ไขและลบได้เต็มที่ ตราบใดที่ยังไม่มีธุรกรรมจริงผูกอยู่
--   1) ลบโครงการ
--   2) ยกเลิกการยืนยัน BOQ เพื่อกลับไปแก้ตัวเลขได้
--   3) ลบ BOQ ทั้งเวอร์ชัน
--
-- เงื่อนไขเดียวที่ยังล็อกไว้คือ โครงการต้องไม่มีเอกสารต้นทุน
-- (ใบขอซื้อ ใบสั่งซื้อ ใบแจ้งหนี้ ค่าใช้จ่าย สัญญาผู้รับเหมาช่วง)
-- เพราะถ้าแก้งบทับหลังสั่งซื้อไปแล้ว ระบบจะอธิบายไม่ได้ว่ากำไรต่างจากที่คาดเพราะอะไร
-- ซึ่งเป็นเหตุผลหลักที่สร้างระบบนี้ขึ้นมา
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

-- โครงการมีเอกสารต้นทุนผูกอยู่หรือไม่
create or replace function public.project_has_cost_documents(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.purchase_requests where project_id = p_project_id)
      or exists (select 1 from public.purchase_orders where project_id = p_project_id)
      or exists (select 1 from public.invoices where project_id = p_project_id)
      or exists (select 1 from public.expenses where project_id = p_project_id)
      or exists (select 1 from public.subcontract_agreements where project_id = p_project_id)
$$;

-- ---------- 1) ลบโครงการ ----------
-- ตารางเอกสารต้นทุนตั้ง foreign key แบบไม่ cascade ไว้โดยตั้งใจ
-- ฐานข้อมูลจึงปฏิเสธการลบเองอีกชั้นถ้ามีเอกสารเหล่านี้ ส่วน BOQ และสมาชิกโครงการ cascade ตามไปได้
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using (public.current_role_name() in ('management', 'admin'));

-- ---------- 2) ยกเลิกการยืนยัน BOQ ----------
-- trigger เดิมห้ามย้อนสถานะจาก confirmed กลับเป็น draft ทุกกรณี
-- เปลี่ยนเป็นห้ามเฉพาะตอนที่ไม่ได้มาจากฟังก์ชัน unconfirm_boq_version
-- ใช้ค่า setting ระดับ transaction เป็นตัวบอก จึงปลอมจากฝั่งแอปไม่ได้
create or replace function public.boq_versions_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' and new.status = 'draft'
     and coalesce(current_setting('app.allow_unconfirm', true), '') <> 'on' then
    raise exception 'ย้อนสถานะ BOQ ที่ยืนยันแล้วไม่ได้ ต้องใช้คำสั่งยกเลิกการยืนยัน';
  end if;
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'BOQ version นี้ถูกแทนที่แล้ว';
  end if;
  return new;
end $$;

create or replace function public.unconfirm_boq_version(p_version_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_version public.boq_versions%rowtype;
begin
  if public.current_role_name() not in ('management', 'admin') then
    raise exception 'เฉพาะฝ่ายบริหารเท่านั้นที่ยกเลิกการยืนยัน BOQ ได้';
  end if;
  select * into v_version from public.boq_versions where id = p_version_id for update;
  if not found then raise exception 'ไม่พบ BOQ version'; end if;
  if v_version.status <> 'confirmed' then raise exception 'BOQ version นี้ไม่ได้อยู่ในสถานะยืนยัน'; end if;
  if public.project_has_cost_documents(v_version.project_id) then
    raise exception 'โครงการนี้มีเอกสารต้นทุนผูกอยู่แล้ว ยกเลิกการยืนยันไม่ได้ ต้องแก้ด้วยการทำ VO';
  end if;

  perform set_config('app.allow_unconfirm', 'on', true);
  update public.boq_versions
     set status = 'draft', confirmed_by = null, confirmed_at = null
   where id = p_version_id;
  perform set_config('app.allow_unconfirm', 'off', true);

  -- ถ้าโครงการไม่เหลือ BOQ ที่ยืนยันแล้ว ให้กลับไปเป็นร่าง
  if not exists (
    select 1 from public.boq_versions where project_id = v_version.project_id and status = 'confirmed'
  ) then
    update public.projects set status = 'draft'
     where id = v_version.project_id and status = 'active';
  end if;
end $$;

-- ---------- 3) ลบ BOQ ทั้งเวอร์ชัน ----------
-- trigger boq_items_lock ห้ามลบรายการของเวอร์ชันที่ยืนยันแล้ว
-- แต่การลบทั้งเวอร์ชันเป็นคนละเรื่อง จึงยกเว้นให้เมื่อแถวแม่กำลังถูกลบอยู่
create or replace function public.boq_items_lock()
returns trigger language plpgsql as $$
declare v_status public.boq_version_status;
begin
  select status into v_status from public.boq_versions where id = coalesce(new.boq_version_id, old.boq_version_id);
  -- ไม่พบเวอร์ชันแม่ แปลว่ากำลังถูกลบทั้งเวอร์ชัน (cascade) ปล่อยผ่าน
  if v_status is null then return coalesce(new, old); end if;
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

drop policy if exists boq_versions_delete on public.boq_versions;
create policy boq_versions_delete on public.boq_versions for delete to authenticated
  using (
    (public.current_role_name() in ('management', 'admin')
      and not public.project_has_cost_documents(project_id))
    or (public.can_manage_project(project_id) and status = 'draft')
  );
