-- ============================================================
-- Feature: selfie ตอนเช็คอิน
-- เพิ่มคอลัมน์เก็บ URL รูป selfie ในตาราง attendance_logs
-- และสร้าง storage bucket สำหรับเก็บรูป
-- (ไม่กระทบ schema เดิม — เพิ่มคอลัมน์ nullable อย่างเดียว)
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

-- 1) คอลัมน์เก็บ URL รูป selfie (nullable — เช็คอินเดิมที่ไม่มีรูปยังใช้ได้)
alter table public.attendance_logs
  add column if not exists selfie_url text;

-- 2) storage bucket สำหรับรูป selfie (public read เพื่อให้ HR เปิดดูรูปได้)
insert into storage.buckets (id, name, public)
values ('attendance-selfies', 'attendance-selfies', true)
on conflict (id) do nothing;

-- 3) policy: อนุญาตให้อัปโหลด (insert) รูปลง bucket นี้
--    แอปเขียนผ่าน anon key จึงเปิดสิทธิ์ให้ role anon/authenticated
drop policy if exists "attendance selfies upload" on storage.objects;
create policy "attendance selfies upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'attendance-selfies');

-- 4) policy: อนุญาตให้อ่านรูป (bucket เป็น public อยู่แล้ว แต่กำหนดชัดเจน)
drop policy if exists "attendance selfies read" on storage.objects;
create policy "attendance selfies read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'attendance-selfies');
