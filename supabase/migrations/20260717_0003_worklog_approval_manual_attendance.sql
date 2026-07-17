-- ============================================================
-- Features เพิ่มเติม:
-- 1) หัวหน้าอนุมัติบันทึกการปฏิบัติงาน (แทนการเซ็นใบกระดาษ)
-- 2) เงินได้อื่นๆ ในบันทึกงาน (สำหรับใบปฏิบัติงาน)
-- 3) เช็คอิน/เอาท์ย้อนหลัง กรอกสถานที่เอง (นอกพื้นที่ที่กำหนด)
-- เพิ่มคอลัมน์ nullable/มี default ทั้งหมด — ไม่กระทบ schema เดิม
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

-- work_logs: การอนุมัติของหัวหน้า + เงินได้อื่นๆ
alter table public.work_logs
  add column if not exists approval_status text not null default 'pending';   -- pending / approved
alter table public.work_logs
  add column if not exists approved_by uuid;                                   -- approvers.id
alter table public.work_logs
  add column if not exists approved_at timestamptz;
alter table public.work_logs
  add column if not exists other_income numeric default 0;                     -- ค่าเงินได้อื่นๆ

-- attendance_logs: บันทึกย้อนหลัง / กรอกสถานที่เอง / นอกพื้นที่
alter table public.attendance_logs
  add column if not exists is_manual boolean not null default false;           -- กรอกย้อนหลังเอง
alter table public.attendance_logs
  add column if not exists is_outside_geofence boolean not null default false; -- ทำนอกพื้นที่ที่กำหนด
alter table public.attendance_logs
  add column if not exists manual_location text;                               -- สถานที่ที่กรอกเอง
