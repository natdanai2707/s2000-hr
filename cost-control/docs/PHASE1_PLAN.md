# S-2000 Project Cost Control: แผนเฟส 1 (รอยืนยัน)

## โครงสร้างโปรเจกต์

แอปใหม่อยู่ที่ `cost-control/` ในรีโปนี้ แยก package.json, Supabase project และ Vercel project จากแอป HR
เหตุผล: HR ใช้ NextAuth + LINE login และเขียน DB ผ่าน anon key โดยไม่มี RLS ส่วนระบบนี้ต้องใช้ Supabase Auth (email + password) และบังคับสิทธิ์ด้วย RLS ทุกตาราง ถ้าใช้ DB เดียวกันจะปนกันและเสี่ยงเปิดสิทธิ์ผิด

Convention ที่ยืมจาก HR: โฟลเดอร์ `src/app`, `src/lib`, `src/components`, migration ใน `supabase/migrations/YYYYMMDD_NNNN_ชื่อ.sql` พร้อมคอมเมนต์ไทย, helper วันที่ใน `src/lib/date.ts` แบบ Asia/Bangkok, ฟอนต์ Noto Sans Thai ผ่าน next/font, design token ใน globals.css

Supabase client แยก 3 ตัว: browser client, server client (cookie) สำหรับ Server Actions และ RSC, service-role client เฉพาะงาน seed และ notification

## Data model เฟส 1 (17 ตาราง 2 views)

| กลุ่ม | ตาราง | หมายเหตุ |
|---|---|---|
| ผู้ใช้ | branches, profiles, project_members | role enum 7 ค่า, trigger สร้าง profile จาก auth.users |
| โครงการ | projects, boq_versions, boq_sections, boq_items | confirmed ได้ 1 version ต่อโครงการ (partial unique index), รายการ "นอก BOQ" สร้างอัตโนมัติเมื่อยืนยัน version |
| จัดซื้อ | purchase_requests, purchase_request_items, approvals, purchase_orders, purchase_order_items, suppliers | PR status 6 ค่า, approvals เก็บทุกขั้น |
| ต้นทุน | goods_receipts, goods_receipt_items, invoices, payments, expenses | expenses นับเป็น actual และ paid พร้อมกัน |
| ระบบ | settings, notifications, audit_logs, boq_import_templates | audit เขียนด้วย trigger ทุกตารางเงินและสถานะ |

ตารางเฟส 2 และ 3 (tasks, progress_updates, subcontract, closeouts, price_history, issues) ยังไม่สร้างในเฟส 1 แต่ enum และ FK ออกแบบเผื่อไว้แล้ว

### กติกาตัวเลข 4 ชั้น (คำนวณใน view เท่านั้น)

budget = qty × unit_cost ของ boq_items ใน version ที่ status = confirmed
committed = Σ (qty_po − qty_received) × unit_price ของ PO ที่ status issued หรือ partially_received
actual = Σ qty_received × unit_cost จาก goods_receipt_items + Σ expenses.amount
paid = Σ payments.amount กระจายตาม PO ลงรายการ BOQ ตามสัดส่วนมูลค่า PO item + Σ expenses.amount

`v_boq_item_costs` ให้ budget, committed, actual, paid, qty_ordered, qty_received, qty_remaining ต่อรายการ
`v_project_summary` ให้ contract_value, total_budget, expected_profit, committed, actual, paid, cost_pct, forecast_profit (progress_pct เป็น null จนเฟส 2)

### สิ่งที่ตัดสินใจเองแล้ว (บันทึกใน DECISIONS.md)

BOQ ที่แตกเป็น material และ labor ใช้ item_no เดียวกัน แยกด้วย category
PR ที่มีหลายรายการ ใช้กติกา routing จากรายการที่แย่ที่สุด (ถ้ารายการใดเกิน BOQ หรือยอดรวมเกิน pm_approval_limit ไปขั้น management)
เลขเอกสาร PR-YYMM-NNNN และ PO-YYMM-NNNN สร้างจาก sequence ต่อเดือน
paid ต่อรายการ BOQ กระจายตามสัดส่วนมูลค่า PO item เพราะ invoice ผูกระดับ PO ไม่ใช่ระดับรายการ
ไฟล์แนบเก็บใน Storage bucket `project-files` เป็น private และอ่านผ่าน signed URL

## หน้าจอเฟส 1 (16 หน้า)

| # | เส้นทาง | หน้า | ใครใช้ |
|---|---|---|---|
| 1 | /login | เข้าสู่ระบบ email + password | ทุกคน |
| 2 | / | แดชบอร์ด card โครงการ active พร้อมแถบสีซ้าย (เฉพาะส่วนต้นทุน) | ทุกคน |
| 3 | /projects | รายการโครงการ + สร้างโครงการ | management, admin |
| 4 | /projects/[id] | หน้าโครงการ: สรุปตัวเลข, ตาราง BOQ 4 ชั้น, PR รออนุมัติ, สมาชิก | สมาชิกโครงการ |
| 5 | /projects/[id]/boq/import | อัปโหลด .xlsx, ตัวอย่าง 20 แถว, จับคู่คอลัมน์, บันทึก template ตามชื่อชีต | PM, management |
| 6 | /projects/[id]/boq/[versionId] | ดู version, สรุปต้นทุน ราคาขาย กำไร แยกหมวด, ปุ่มยืนยัน BOQ (management), นำเข้า VO | สมาชิกโครงการ |
| 7 | /pr | รายการใบขอซื้อ (กรองสถานะ) | ทุกคน |
| 8 | /pr/new | ฟอร์มมือถือ + กล่องเปรียบเทียบ BOQ + offline queue | engineer ขึ้นไป |
| 9 | /pr/[id] | รายละเอียด PR + ปุ่มอนุมัติ/ปฏิเสธขนาดใหญ่ | ผู้อนุมัติ |
| 10 | /approvals | รออนุมัติ (bottom nav แสดงจำนวน) | PM, management |
| 11 | /po | รายการ PO + สร้างจาก PR ที่อนุมัติ + แก้ราคา (เกิน threshold กลับไปอนุมัติ) | purchasing |
| 12 | /po/[id] | รายละเอียด PO + ประวัติรับของ | purchasing, site |
| 13 | /receiving | รับของจากมือถือ: เลือก PO, ปริมาณจริง, รูปแนบ, รับบางส่วน | site_supervisor |
| 14 | /finance | ใบแจ้งหนี้และการชำระเงิน (บันทึก invoice ผูก PO, บันทึก payment) | accounting |
| 15 | /expenses/new | บันทึกค่าใช้จ่ายเบ็ดเตล็ด ผูก BOQ item | engineer ขึ้นไป |
| 16 | /notifications | แจ้งเตือนในแอป | ทุกคน |

เมนู sidebar ครบ 12 รายการตามสเปก แต่รายการของเฟส 2 และ 3 (แผนงาน ความก้าวหน้า ปิดโครงการ บันทึกปัญหา ฐานราคาวัสดุ ผู้ใช้และสิทธิ์ ตั้งค่า) แสดงหน้า "ยังไม่เปิดใช้งาน"
Mobile bottom nav: หน้าหลัก / ขอซื้อ / ความก้าวหน้า (ยังไม่เปิดใช้งาน) / รออนุมัติ + ปุ่มเพิ่มเติม

## Test เฟส 1

vitest: การคำนวณ 4 ชั้น (SQL ผ่าน pg ในเครื่องหรือ Supabase local), approval routing, การแตกแถว BOQ วัสดุ/แรงงาน, RLS แยกโครงการ (engineer โครงการ A อ่าน B ไม่ได้)

## Seed

3 สาขา, ผู้ใช้ทดสอบ 7 role (รหัสผ่านเดียวกัน กำหนดใน seed), โครงการตัวอย่าง 1 โครงการ BOQ 30 รายการ 3 หมวด พร้อม PR PO รับของ invoice payment ตัวอย่างเพื่อให้แดชบอร์ดมีตัวเลข
