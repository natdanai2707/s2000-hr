-- ============================================================
-- เก็บชื่อไฟล์ BOQ ตามที่ผู้ใช้อัปโหลด แยกจาก path ใน Storage
-- เพราะ path ต้องเป็นอักขระ ASCII เท่านั้น ชื่อไฟล์ภาษาไทยใช้เป็น path ไม่ได้
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

alter table public.boq_versions
  add column if not exists source_file_name text;
