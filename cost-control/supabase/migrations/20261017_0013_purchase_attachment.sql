-- ============================================================
-- แนบรูปหรือ PDF ของใบสั่งซื้อ ใบกำกับภาษี หรือใบเสร็จไว้กับรายการสั่งซื้อ
-- ระบบให้ Claude อ่านเอกสารนี้เพื่อกรอกรายการให้ และเก็บไฟล์ไว้เป็นหลักฐานของต้นทุน
-- ไฟล์อยู่ใน bucket project-files ใต้ projects/{project_id}/purchases/ ตาม RLS เดิมของ storage
-- ============================================================

alter table public.purchase_requests add column if not exists attachment_path text;
