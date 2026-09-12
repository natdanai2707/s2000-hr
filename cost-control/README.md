# S-2000 Project Cost Control

ระบบควบคุมต้นทุนและติดตามโครงการของ บริษัท เอส-2000 สตีล แฟบริเคท จำกัด บันทึก "งาน" คู่กับ "เงิน" ของทุกโครงการ ตอบคำถามแบบ real time ว่าโครงการใช้ต้นทุนไปกี่เปอร์เซ็นต์ของงบ การสั่งซื้อเกิน BOQ หรือแพงกว่าราคาที่ทดไว้หรือไม่ และกำไรพยากรณ์ต่างจากกำไรคาดหวังเท่าไร

Stack: Next.js 16 (App Router, TypeScript, Server Actions), Supabase (Postgres, Auth, RLS, Storage), Tailwind CSS 4 + shadcn/ui, ExcelJS, Recharts (เฟส 2), PWA, deploy บน Vercel

สถานะ: เฟส 1 เสร็จ (scaffold, schema ทุกตาราง, RLS, audit trigger, auth, โครงการ, นำเข้าและยืนยัน BOQ, ใบขอซื้อพร้อมเปรียบเทียบ BOQ และ approval routing, PO, รับของ, ค่าใช้จ่าย, ใบแจ้งหนี้, ชำระเงิน, views, แดชบอร์ด, in-app notification, PWA + offline PR form, seed) เฟส 2 และ 3 ยังไม่เริ่ม ดูรายการการตัดสินใจใน `DECISIONS.md`

## โครงสร้าง

```
cost-control/
  supabase/migrations/   SQL migration รันตามลำดับเลขไฟล์ใน Supabase SQL Editor
  supabase/tests/        shim สำหรับรัน migration บน Postgres ธรรมดาตอนทดสอบ
  src/app/               หน้าจอ (App Router) กลุ่ม (app) ต้อง login
  src/actions/           Server Actions
  src/lib/               Supabase client, routing, BOQ parser, offline queue, notification
  src/components/        ui (shadcn) และ app (shell, ฟอร์ม, ตาราง)
  scripts/seed.ts        seed ผู้ใช้ทดสอบและโครงการตัวอย่าง
  docs/samples/          ไฟล์ BOQ ตัวอย่าง (boq-sample.xlsx)
  tests/                 vitest (unit + database)
```

## 1. ตั้งค่า Supabase

1. สร้าง Supabase project ใหม่ (แยกจากแอป HR) เลือก region Singapore
2. เปิด Authentication > Providers > Email เปิด Email provider และปิด "Confirm email" ถ้าต้องการให้ admin สร้างผู้ใช้แล้วใช้ได้ทันที (ระบบไม่มีหน้าสมัครสมาชิก ผู้ใช้ถูกสร้างโดย admin หรือ seed)
3. เปิด SQL Editor รันไฟล์ใน `supabase/migrations/` ตามลำดับ

   | ไฟล์ | เนื้อหา |
   |---|---|
   | `20260911_0001_schema.sql` | enum, ตารางทั้งหมด, trigger สร้าง profile, seed สาขาและ settings, storage bucket `project-files` |
   | `20260911_0002_audit_and_functions.sql` | audit trigger, ล็อก BOQ, ฟังก์ชันธุรกิจ (ยืนยัน BOQ, VO, ส่ง/อนุมัติ PR, ออก PO, สถานะ PO/invoice) |
   | `20260911_0003_rls.sql` | RLS policy ทุกตารางและ storage |
   | `20260911_0004_views.sql` | `v_boq_item_costs`, `v_project_summary`, `v_boq_section_summary` |

4. คัดลอกค่าใน Project Settings > API: Project URL, anon key, service_role key

## 2. Environment variables

สร้าง `cost-control/.env.local` จาก `.env.example`

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (ผ่าน RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | ใช้ฝั่ง server เท่านั้น: notification, cron, seed |
| `SEED_USER_PASSWORD` | รหัสผ่านผู้ใช้ทดสอบตอน seed (ค่าเริ่มต้น `S2000test!`) |
| `LINE_MESSAGING_TOKEN` | เฟส 2 ถ้าว่างระบบจะ log แทนการส่ง LINE |
| `CRON_SECRET` | กันคนนอกเรียก `/api/cron/invoice-due` (Vercel ใส่ header ให้อัตโนมัติ) |

## 3. รันในเครื่อง

```bash
cd cost-control
npm install
npm run seed      # สร้างผู้ใช้ทดสอบ 7 role + โครงการตัวอย่าง (รันซ้ำได้ ข้ามถ้ามีแล้ว)
npm run dev
```

ผู้ใช้ทดสอบ (รหัสผ่านตาม `SEED_USER_PASSWORD`)

| อีเมล | บทบาท |
|---|---|
| engineer@s2000.test | วิศวกร |
| site@s2000.test | หัวหน้าหน้างาน |
| pm@s2000.test | ผู้จัดการโครงการ |
| purchasing@s2000.test | จัดซื้อ |
| accounting@s2000.test | บัญชี |
| management@s2000.test | ฝ่ายบริหาร |
| admin@s2000.test | ผู้ดูแลระบบ |

โครงการตัวอย่าง `PJ-2569-001` มี BOQ 30 แถว (แตกเป็นรายการวัสดุ/แรงงาน) ยืนยันแล้ว พร้อม PR 4 ใบในสถานะต่างกัน PO 2 ใบ รับของบางส่วน ใบแจ้งหนี้ การชำระเงิน และค่าใช้จ่ายเบ็ดเตล็ด ทดสอบหน้านำเข้า BOQ ได้ด้วยไฟล์ `docs/samples/boq-sample.xlsx`

การเพิ่มผู้ใช้จริงในเฟส 1: สร้างใน Supabase Authentication > Users (ใส่ user metadata `full_name`, `role`, `branch_id`) trigger จะสร้าง `profiles` ให้ หรือแก้ role ในตาราง `profiles` โดยตรง หน้าจัดการผู้ใช้อยู่ในเฟส 3

## 4. ทดสอบ

```bash
npm run typecheck
npm run lint
npm test                          # unit: routing, แตกแถว BOQ, variance decomposition, parse ไฟล์ตัวอย่าง
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/s2000_test npm test   # เพิ่ม test ฐานข้อมูล
```

Test ฐานข้อมูลต้องมี Postgres 15 ขึ้นไป (ไม่ใช่ Supabase จริง) ระบบจะ drop schema แล้วรัน shim + migration ใหม่ทุกครั้ง ครอบคลุม ตัวเลข 4 ชั้นจาก view, approval routing, RLS แยกโครงการ (engineer โครงการ A อ่าน B ไม่ได้), ล็อก BOQ, VO, audit log

## 5. Deploy บน Vercel

1. Import รีโป `s2000-hr` ใน Vercel สร้างเป็น project ใหม่ (แยกจาก HR) ตั้ง Root Directory เป็น `cost-control` Framework Preset Next.js
2. ใส่ Environment Variables ตามข้อ 2 (Production และ Preview) `CRON_SECRET` ต้องตั้งเพื่อให้ Vercel Cron ส่ง Authorization header
3. Deploy ไฟล์ `vercel.json` ในโฟลเดอร์นี้กำหนด cron `/api/cron/invoice-due` ทุกวัน 01:00 UTC (08:00 น. ไทย)
4. ใน Supabase Authentication > URL Configuration ใส่ Site URL เป็นโดเมน Vercel

## PWA และ offline

ติดตั้งบนมือถือได้จาก manifest (`/manifest.webmanifest`) service worker (`public/sw.js`) ทำงานเฉพาะ production ฟอร์มใบขอซื้อส่งขณะออฟไลน์จะเก็บใน IndexedDB แสดงสถานะ "รอส่ง" และส่งอัตโนมัติเมื่อกลับมาออนไลน์ (กันส่งซ้ำด้วย client_ref)

## หมายเหตุการออกแบบ

ตัวเลข 4 ชั้นต่อรายการ BOQ (budget / committed / actual / paid) ไม่ถูกเก็บในตารางใด คำนวณจากเอกสารต้นทางใน view `v_boq_item_costs` เท่านั้น BOQ ที่ยืนยันแล้วถูกล็อกด้วย trigger การเปลี่ยนแปลงต้องทำเป็น VO ทุกรายการต้นทุนต้องผูก `boq_item_id` เสมอ (รายการ "นอก BOQ" ระบบสร้างให้ต่อโครงการ) สิทธิ์บังคับด้วย RLS ที่ฐานข้อมูล และทุกการเปลี่ยนแปลงตัวเลขเงินและสถานะมี audit log
