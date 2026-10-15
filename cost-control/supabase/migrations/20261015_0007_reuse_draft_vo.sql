-- ============================================================
-- แก้ BOQ ที่ยืนยันแล้วโดยไม่ต้องอัปโหลดไฟล์ใหม่
-- กดปุ่มแก้ไข BOQ จากหน้าโครงการ ระบบเปิดร่าง VO ให้ แก้ปริมาณหรือเพิ่มรายการได้ แล้วกดยืนยัน
--
-- เดิมทุกครั้งที่กดสร้าง VO จะได้เวอร์ชันใหม่เสมอ กดสองครั้งก็ได้ร่างค้างสองอัน
-- เปลี่ยนเป็นถ้ามีร่าง VO ค้างอยู่แล้วให้ใช้อันเดิมต่อ
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

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
    raise exception 'ไม่มีสิทธิ์แก้ BOQ ของโครงการนี้';
  end if;

  -- มีร่าง VO ค้างอยู่แล้วให้แก้อันเดิมต่อ ไม่สร้างซ้ำ
  select id into v_new_id
    from public.boq_versions
   where project_id = p_project_id and status = 'draft' and type = 'variation_order'
   order by version_no desc
   limit 1;
  if v_new_id is not null then
    if coalesce(trim(p_note), '') <> '' then
      update public.boq_versions set note = p_note where id = v_new_id;
    end if;
    return v_new_id;
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
