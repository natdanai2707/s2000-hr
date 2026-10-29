-- ============================================================
-- สมัครใช้งานเอง: บัญชีที่สมัครเองเริ่มเป็นวิศวกรและยังไม่เปิดใช้งาน รอฝ่ายบริหารเลือกสิทธิ์และเปิดบัญชี
-- สิทธิ์ของบัญชีใหม่อ่านจาก app_metadata เท่านั้น (ตั้งได้ด้วย service role) ไม่อ่านจาก user_metadata
-- ซึ่งผู้สมัครกำหนดเองได้ตอนเรียก signUp ไม่งั้นใครก็สมัครเป็นฝ่ายบริหารได้
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, role, branch_id, is_active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
    coalesce(v_role::public.user_role, 'engineer'),
    (new.raw_app_meta_data ->> 'branch_id')::uuid,
    v_role is not null
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ผู้ใช้แก้ชื่อตัวเองได้ แต่สิทธิ์ สถานะบัญชี และสาขา แก้ได้เฉพาะฝ่ายบริหาร ผู้ดูแลระบบ หรือ service role
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.branch_id is distinct from old.branch_id)
     and coalesce(public.current_role_name()::text, '') not in ('management', 'admin') then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนสิทธิ์หรือสถานะบัญชี';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();
