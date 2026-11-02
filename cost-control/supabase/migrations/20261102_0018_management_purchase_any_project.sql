-- ============================================================
-- ฝ่ายบริหารและผู้ดูแลระบบบันทึกการสั่งซื้อได้ทุกโครงการ ไม่ต้องเป็นสมาชิกโครงการ
-- หน้าบันทึกการสั่งซื้อแสดงทุกโครงการให้สองสิทธิ์นี้อยู่แล้ว แต่ policy เดิมรับเฉพาะสมาชิกโครงการ
-- จึงบันทึกไม่ได้ด้วย "new row violates row-level security policy for table purchase_requests"
-- สิทธิ์อื่นยังต้องเป็นสมาชิกโครงการเหมือนเดิม และผู้ขอต้องเป็นตัวเองเสมอ
-- ============================================================

drop policy if exists pr_insert on public.purchase_requests;
create policy pr_insert on public.purchase_requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'draft'
    and (public.is_project_member(project_id) or public.current_role_name() in ('management', 'admin'))
  );
