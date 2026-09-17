# DECISIONS: S-2000 Project Cost Control

บันทึกการตัดสินใจเรื่องที่สเปกไม่ได้ระบุ เรียงตามลำดับที่ตัดสินใจ

## โครงสร้างโปรเจกต์

1. แอปใหม่อยู่ที่ `cost-control/` ในรีโป s2000-hr แยก package.json, Supabase project และ Vercel project จากแอป HR เพราะ HR ใช้ NextAuth กับ LINE login และเขียน DB ผ่าน anon key โดยไม่มี RLS ถ้ารวม DB จะปนกันและเสี่ยงเปิดสิทธิ์ผิด ยืม convention โฟลเดอร์ migration (คอมเมนต์ไทย รันใน SQL Editor), date helper แบบ Asia/Bangkok และฟอนต์ Noto Sans Thai ผ่าน next/font มาใช้
2. Supabase client แยก 3 ตัว: browser (`src/lib/supabase/client.ts`), server ผ่าน cookie (`server.ts`) สำหรับ Server Component และ Server Action, service role (`admin.ts`) เฉพาะ notification, cron และ seed ห้าม import จาก client
3. ใช้ `src/proxy.ts` (ชื่อใหม่ของ middleware ใน Next.js 16) refresh session และบังคับ login ทุกหน้า ยกเว้น `/login` และ `/offline`
4. shadcn/ui เขียน component ลงรีโปโดยตรง (button, input, select, dialog, table, badge, card, alert) ไม่ใช้ CLI เพราะต้องควบคุมให้ไม่มีไอคอนและ touch target 44px `select` ใช้ native select เพื่อใช้บนมือถือได้ดี

## ฐานข้อมูล

5. ตารางเฟส 2 และ 3 ที่ผูก FK กับตารางเฟส 1 (subcontract_agreements, work_completion_certificates) สร้างไว้ตั้งแต่เฟส 1 พร้อม RLS เพื่อให้ view `v_boq_item_costs` นับ actual ของผู้รับเหมาช่วงได้โดยไม่ต้องแก้ view ทีหลัง ตารางที่เหลือ (tasks, progress_updates, closeouts, price_history, issues) สร้างในเฟสของตัวเอง
6. เลขเอกสาร `PR-YYMM-NNNN` และ `PO-YYMM-NNNN` ออกจากตาราง `document_counters` ต่อเดือน (เวลาไทย) ผ่านฟังก์ชัน `next_document_no`
7. การเปลี่ยนสถานะเอกสารสำคัญ (ยืนยัน BOQ, ส่ง PR, อนุมัติ/ปฏิเสธ, ออก PO, สร้าง VO) ทำผ่านฟังก์ชัน `security definer` ที่ตรวจสิทธิ์เอง ไม่เปิด update policy ให้แก้สถานะตรง เพื่อให้ routing และ approvals ถูกบันทึกครบทุกครั้ง
8. รายการ "นอก BOQ" (`is_off_boq = true`, item_no `OFF`) สร้างอัตโนมัติตอนยืนยัน version และถูก copy ไปทุก VO รายการนี้เป็นรายการเดียวใน version ที่ยืนยันแล้วซึ่ง trigger ยอมให้ insert
9. VO: `create_variation_order` copy หมวดและรายการทั้งหมดจาก version ที่ยืนยัน โดยเก็บ `origin_item_id` เมื่อยืนยัน VO ระบบย้าย `boq_item_id` ของ PR, PO, รับของ, expenses และสัญญาผู้รับเหมาช่วง จากรายการเดิมไปยังรายการใหม่ ทำให้ view คำนวณจาก version ปัจจุบันได้โดยไม่ต้อง resolve สายโซ่ version (audit log บันทึกการย้ายนี้)
10. `paid` ต่อรายการ BOQ: invoice ผูกระดับ PO ไม่ใช่ระดับรายการ จึงกระจายยอดชำระของ PO ลงรายการตามสัดส่วนมูลค่ารายการใน PO (`qty × unit_price / total PO`) expenses นับเป็น actual และ paid เต็มจำนวนทันที
11. `committed` = Σ (qty PO − qty รับแล้ว) × ราคา PO ของ PO ที่ไม่ยกเลิก เมื่อรับครบ committed เป็น 0 และ actual ใช้ราคาที่รับจริง (สต็อกภายในใช้ราคาทุน)
12. `forecast_profit` = contract_value − (actual + committed + (qty − qty สั่งแล้ว) × unit_cost) รายการที่รับเกิน BOQ ไม่ติดลบส่วนที่ยังไม่สั่ง (greatest 0)
13. สถานะสีบน card ในเฟส 1 ที่ยังไม่มีความก้าวหน้า: ต้นทุนเกินงบหรือกำไรพยากรณ์ติดลบ = เตือน, ต้นทุน > 95% ของงบ = เฝ้าระวัง เมื่อเฟส 2 มี progress_pct จะใช้กติกา ส่วนต่าง ≤ 0 / 0 ถึง 5 / > 5 ตามสเปกโดยอัตโนมัติ (โค้ดใน `project-card.tsx` เช็ค cost_vs_progress ก่อน)
14. View ใช้ `security_invoker = true` ให้ RLS ของตารางต้นทางมีผลกับ view ทุกตัว
15. Storage bucket `project-files` เป็น private path ขึ้นต้น `projects/<project_id>/` policy ตรวจ `can_view_project` จาก folder ที่ 2 อ่านผ่าน signed URL อายุ 1 ชั่วโมง
16. Audit trigger เขียนเฉพาะเมื่อค่าเปลี่ยนจริง (ไม่นับ updated_at) และเก็บ `auth.uid()` ของผู้ทำ; service role จะได้ user_id null

## สิทธิ์

17. purchasing และ accounting ดูได้ทุกโครงการ (ไม่ต้องเป็นสมาชิก) เพราะต้องออก PO และบันทึก invoice ข้ามโครงการ engineer / site_supervisor / project_manager เห็นเฉพาะโครงการที่เป็นสมาชิก
18. management อนุมัติ PR ได้ทั้งขั้น PM และขั้น management ถ้า management อนุมัติที่ขั้น PM ระบบข้ามขั้น management ทันที
19. PR ที่มีหลายรายการใช้กติกาจากรายการที่แย่ที่สุด: รายการใดเกิน BOQ (หรือเป็นนอก BOQ) หรือมูลค่ารวมเกิน `pm_approval_limit` จะต้องผ่าน management
20. ผู้สร้างโครงการ (management/admin/project_manager) เป็นสมาชิกโครงการอัตโนมัติ
21. profiles: ผู้ใช้แก้ชื่อและ line_user_id ของตัวเองได้ แต่ trigger ห้ามเปลี่ยน role, is_active, branch_id ยกเว้น admin

## จัดซื้อ

22. ฝ่ายจัดซื้อแก้ราคาตอนออก PO ได้ ถ้าราคาใหม่แพงกว่าราคาใน PR เกิน threshold ระบบจะไม่ออก PO แต่ปรับราคาใน PR ตั้ง flag ใหม่ และส่ง PR กลับเข้า routing ตั้งแต่ขั้น PM (PO status enum ไม่มีสถานะรออนุมัติ จึงคุมที่ PR แทน)
23. PR ที่ถูกปฏิเสธ เจ้าของแก้ไขและส่งใหม่ได้ (สถานะ rejected ถือเป็นร่างที่แก้ได้)
24. ยกเลิก PO ได้เฉพาะ PO ที่ยังไม่มีการรับของ
25. รับของ: site_supervisor และ project_manager ที่เป็นสมาชิกโครงการ รวมถึง purchasing และ management รับของได้ รับบางส่วนได้ สถานะ PO อัปเดตอัตโนมัติด้วย trigger
26. ใบแจ้งหนี้: สถานะเป็น paid อัตโนมัติเมื่อ Σ payments ≥ amount (trigger) และกลับเป็น approved ถ้าลบ payment
27. price_history (เฟส 3) จะเขียนตอนยืนยันรับของผ่าน trigger ที่จะเพิ่มในเฟส 3 ไม่ทำในเฟส 1 เพื่อไม่ให้มีตารางที่ไม่มีหน้าจอใช้

## Offline และ PWA

28. Service worker เขียนเอง (`public/sw.js`) ไม่ใช้ next-pwa: หน้า HTML ใช้ network-first ตกมา cache แล้วหน้า `/offline`, ไฟล์ static ใช้ stale-while-revalidate ไม่ลงทะเบียนใน development
29. Offline queue เก็บใน IndexedDB (`idb`) ต่อ kind ฟอร์ม PR สร้าง `client_ref` (uuid) ก่อนส่ง server action ตรวจ `client_ref` ซ้ำเพื่อกันสร้าง PR ซ้ำเมื่อ retry `OfflineSync` ใน layout ส่งคิวเมื่อ online และทุก 60 วินาที
30. ฟอร์ม PR ที่ส่งขณะออนไลน์แล้ว network ล้มกลางทาง จะถูกเก็บเข้าคิวเช่นกัน (ใช้ client_ref เดิม)

## การแจ้งเตือน

31. notifications เขียนผ่าน service role เท่านั้น (ไม่มี insert policy ให้ authenticated) กันผู้ใช้สร้างแจ้งเตือนถึงคนอื่น ผู้ใช้อ่านและ mark read ของตัวเองได้
32. LINE channel มีโครงพร้อมแล้วใน `src/lib/notifications/line.ts` ถ้าไม่มี `LINE_MESSAGING_TOKEN` จะ log แทน เหตุการณ์ครบ 5 อย่างตามสเปก invoice ครบกำหนดใน 3 วันใช้ Vercel cron `/api/cron/invoice-due` รายวัน (ป้องกันด้วย `CRON_SECRET`) และกันแจ้งซ้ำวันเดียวกัน
33. โครงการเข้าสถานะเตือน จะแจ้งเมื่อมี progress (เฟส 2) เพราะกติกาสีต้องใช้ความก้าวหน้า

## นำเข้า BOQ

34. หาแถวหัวตารางอัตโนมัติจาก 30 แถวแรก (แถวที่มีข้อความ ≥ 3 ช่องและมีคำว่า รายการ/ปริมาณ/หน่วย) ตรวจจับ mapping จากชื่อคอลัมน์ไทย/อังกฤษ ผู้ใช้แก้ได้ก่อนนำเข้า template บันทึกตามชื่อชีตแบบ upsert
35. แถวสรุป (รวม/ยอดรวม/total) ที่ไม่มีลำดับและไม่มีปริมาณถูกข้าม ไม่กลายเป็นหมวด
36. แถวที่มีแต่ยอดรวมต่อแถว (ไม่มีราคาวัสดุ/แรงงาน) ถือเป็น material โดย unit_cost = total / qty
37. ชีตที่ไม่มีหัวข้อหมวดเลย ใช้ชื่อชีตเป็นหมวด
38. markup: ถ้าไฟล์ไม่มีคอลัมน์ markup ใช้ค่าเริ่มต้นที่กรอกในหน้านำเข้า (ค่าเดียวทั้ง version) แก้รายรายการได้ตอน draft
39. VO นำเข้าผ่านหน้าเดียวกัน ไฟล์ไม่บังคับ ถ้ามีไฟล์ รายการในไฟล์จะถูกเพิ่มต่อท้ายรายการที่ copy มา

## ทดสอบ

40. Test ฐานข้อมูล (4 ชั้นตัวเลข, routing, RLS, VO, audit) รันกับ Postgres จริงผ่าน `TEST_DATABASE_URL` โดยใช้ shim `supabase/tests/00_supabase_shim.sql` เลียนแบบ schema auth/storage ของ Supabase ข้ามอัตโนมัติถ้าไม่ตั้ง env; test logic บริสุทธิ์ (routing, แตกแถว BOQ, variance decomposition, parse ไฟล์ตัวอย่าง) รันได้ทันที
41. Variance decomposition (เฟส 3) เขียนเป็นฟังก์ชันบริสุทธิ์และทดสอบตั้งแต่เฟส 1 ตามที่สเปกขอ test ครบ 5 หัวข้อ

## รูปแบบ BOQ จริงของ S-2000 (ปรับหลังได้ไฟล์ตัวอย่าง 5 ไฟล์)

42. ไฟล์ BOQ จริงใช้หัวตาราง 2 แถว แถวบนเป็นกลุ่ม (MATERIAL, LABOUR) แถวล่างเป็นหัวย่อย (@, SUB TOTAL) ตัวอ่านจึงรวมสองแถวเป็นชื่อเดียว เช่น "MATERIAL @" กับ "MATERIAL SUB TOTAL" ทำให้แยกราคาต่อหน่วยออกจากยอดรวมของหมวดเดียวกันได้
43. หาแถวหัวตารางด้วยการให้คะแนน แถวที่มีชื่อคอลัมน์ที่รู้จักมากที่สุดคือหัวตาราง แทนวิธีเดิมที่เลือกแถวแรกที่เจอคำใดคำหนึ่ง เพราะหัวกระดาษมีคำว่า PROJECT และ BILL OF QUANTITIES อยู่ด้านบน
44. จับคู่ชื่อคอลัมน์หลังตัดเครื่องหมายวรรคตอนออก ทำให้ `Q'TY` จับเป็นปริมาณได้ และ `ITEMS` จับเป็นลำดับได้ เดิมทั้งสองคอลัมน์จับไม่ได้ ทำให้ทุกแถวกลายเป็นหมวดและไม่ได้รายการเลย
45. ชีต BOQ จริงมีบล็อก SUMMARY สรุปยอดต่อหมวดอยู่เหนือรายละเอียด ตัวอ่านข้ามตั้งแต่แถวที่มีคำว่า SUMMARY จนถึงแถว Total ถ้าไม่ข้าม ต้นทุนจะถูกนับซ้ำสองเท่า
46. แถวสรุปที่ merge ทั้งแถว (Sub Total, Total, Overhead & Profit) จะมีข้อความเดียวกันทั้งในคอลัมน์ลำดับและคอลัมน์รายการ ใช้เงื่อนไขนี้ระบุว่าไม่มีลำดับ แล้วข้ามด้วยรูปแบบคำขึ้นต้น
47. `\b` ใช้กับข้อความไทยไม่ได้เพราะอักษรไทยไม่ใช่ word character ของ JavaScript regex จึงตัดออกจากรูปแบบที่ใช้จับแถวสรุป
48. ช่องราคาที่เขียนว่า By Owner แปลว่าผู้ว่าจ้างจัดหาให้ ต้นทุนของเราเป็นศูนย์ ตัวอ่านเก็บรายการไว้ที่ราคา 0 ไม่ทิ้งบรรทัด
49. หมวดสร้างจริงเมื่อเจอรายการแรกใต้หัวข้อเท่านั้น หัวข้อที่ไม่มีรายการ (SUMMARY, หมายเหตุ, หมวดที่มีแต่หมวดย่อย) จึงไม่กลายเป็นหมวดค้างในระบบ ชื่อหมวดใช้หัวข้อย่อยสุด และเก็บหัวข้อที่ครอบอยู่ไว้ในคอลัมน์ code (เปลี่ยนความหมายจากเดิมที่เก็บเลขลำดับของหัวข้อ)
50. ชีตที่ไม่มีคอลัมน์ราคาวัสดุหรือค่าแรงจะไม่ถูกติ๊กนำเข้าอัตโนมัติ เพราะเป็นชีตปกหรือใบเสนอราคาที่มีแต่ยอดรวม ถ้านำเข้าพร้อมชีต BOQ จะนับต้นทุนซ้ำ
51. ไฟล์ VO ที่มีหมวดงานลด (เช่น "หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด") เก็บตัวเลขเป็นบวกในไฟล์ แล้วหักลบกันที่บล็อกสรุป ระบบยังไม่หักลบให้อัตโนมัติ แต่เตือนในหน้านำเข้า และแนะนำให้ลดปริมาณของรายการเดิมในเวอร์ชัน VO แทน เพราะการเก็บรายการลดเป็นปริมาณติดลบจะทำให้ยอดคงเหลือในใบขอซื้อคำนวณผิด รอการตัดสินใจเรื่องนี้จากผู้ใช้
52. ตรวจผลกับไฟล์จริง 5 ไฟล์ ทุกชีตรายละเอียดให้ต้นทุนรวมตรงกับ Sub Total ในไฟล์ทุกบาท ยกเว้นไฟล์ VO ที่ต่างเพราะการหักลบตามข้อ 51 ไฟล์จริงไม่ถูก commit ลงรีโป ใช้ fixture สังเคราะห์ที่จำลองโครงสร้างเดียวกันใน tests/unit/boq-s2000-format.test.ts แทน
