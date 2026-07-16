-- ============================================================
-- Feature: ลงทะเบียนตัวเองสำหรับพนักงานใหม่
-- พนักงานที่ LINE ยังไม่ผูกกับระบบ กรอกชื่อ-นามสกุลแล้วกด submit
-- ระบบบันทึกชื่อ + LINE ID ไว้ให้ HR เข้าไปผูกกับพนักงานภายหลัง
-- (เพิ่มตารางใหม่ ไม่กระทบ schema เดิม)
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  first_name text,
  last_name text,
  display_name text,
  status text not null default 'pending',   -- pending / linked / dismissed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.registration_requests enable row level security;

-- แอปเขียน/อ่านผ่าน anon key — เปิดสิทธิ์ให้ role anon/authenticated
drop policy if exists "registration_requests insert" on public.registration_requests;
create policy "registration_requests insert"
  on public.registration_requests for insert
  to anon, authenticated
  with check (true);

drop policy if exists "registration_requests select" on public.registration_requests;
create policy "registration_requests select"
  on public.registration_requests for select
  to anon, authenticated
  using (true);

drop policy if exists "registration_requests update" on public.registration_requests;
create policy "registration_requests update"
  on public.registration_requests for update
  to anon, authenticated
  using (true)
  with check (true);
