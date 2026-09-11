// BOQ ตัวอย่าง 30 รายการ 3 หมวด ใช้ทั้ง seed และไฟล์ xlsx ตัวอย่าง
// รูปแบบมาตรฐาน S-2000: ลำดับ รายการ หน่วย ปริมาณ ราคาวัสดุ ราคาแรงงาน รวม

export interface SampleRow {
  item_no: string
  description: string
  unit: string | null
  qty: number | null
  material: number | null
  labor: number | null
}

export const SAMPLE_MARKUP_PCT = 12

export const SAMPLE_BOQ: SampleRow[] = [
  { item_no: '1', description: 'งานโครงสร้างเหล็ก', unit: null, qty: null, material: null, labor: null },
  { item_no: '1.1', description: 'เสาเหล็ก H-Beam 300x300x10x15 มม.', unit: 'ตัน', qty: 18.5, material: 31500, labor: 4200 },
  { item_no: '1.2', description: 'คานเหล็ก H-Beam 400x200x8x13 มม.', unit: 'ตัน', qty: 24.2, material: 31000, labor: 4200 },
  { item_no: '1.3', description: 'แปเหล็ก C-Channel 150x50x20x3.2 มม.', unit: 'ตัน', qty: 6.8, material: 29500, labor: 3800 },
  { item_no: '1.4', description: 'เหล็กฉาก 50x50x5 มม. งานค้ำยัน', unit: 'ตัน', qty: 2.4, material: 28800, labor: 3800 },
  { item_no: '1.5', description: 'เพลทฐานเสา หนา 25 มม.', unit: 'แผ่น', qty: 24, material: 3200, labor: 450 },
  { item_no: '1.6', description: 'สลักเกลียวฝังยึด M24', unit: 'ชุด', qty: 96, material: 380, labor: 60 },
  { item_no: '1.7', description: 'สลักเกลียว HTB M20 พร้อมแหวนและน็อต', unit: 'ตัว', qty: 1200, material: 45, labor: 8 },
  { item_no: '1.8', description: 'สีรองพื้นกันสนิม 2 เที่ยว', unit: 'ตร.ม.', qty: 1850, material: 42, labor: 25 },
  { item_no: '1.9', description: 'สีทับหน้าอีพ็อกซี่', unit: 'ตร.ม.', qty: 1850, material: 68, labor: 30 },
  { item_no: '1.10', description: 'ค่าขนส่งโครงสร้างเหล็กจากโรงงานถึงหน้างาน', unit: 'เที่ยว', qty: 8, material: null, labor: 6500 },
  { item_no: '1.11', description: 'รถเครน 25 ตัน งานติดตั้ง', unit: 'วัน', qty: 12, material: null, labor: 8500 },
  { item_no: '2', description: 'งานสถาปัตยกรรม', unit: null, qty: null, material: null, labor: null },
  { item_no: '2.1', description: 'หลังคาเมทัลชีท 0.47 มม. เคลือบสี', unit: 'ตร.ม.', qty: 1420, material: 285, labor: 65 },
  { item_no: '2.2', description: 'ฉนวน PE หนา 5 มม. ใต้หลังคา', unit: 'ตร.ม.', qty: 1420, material: 38, labor: 12 },
  { item_no: '2.3', description: 'ผนังเมทัลชีท 0.40 มม.', unit: 'ตร.ม.', qty: 960, material: 245, labor: 60 },
  { item_no: '2.4', description: 'แผ่นโปร่งแสงไฟเบอร์กลาส', unit: 'ตร.ม.', qty: 120, material: 420, labor: 65 },
  { item_no: '2.5', description: 'รางน้ำสังกะสี พร้อมท่อลง', unit: 'เมตร', qty: 180, material: 320, labor: 90 },
  { item_no: '2.6', description: 'ครอบสันหลังคาและครอบข้าง', unit: 'เมตร', qty: 210, material: 180, labor: 45 },
  { item_no: '2.7', description: 'ประตูม้วนเหล็ก 4x4 เมตร', unit: 'ชุด', qty: 4, material: 38000, labor: 4500 },
  { item_no: '2.8', description: 'ประตูเหล็กบานเปิด 1x2.1 เมตร', unit: 'ชุด', qty: 6, material: 6500, labor: 800 },
  { item_no: '2.9', description: 'พื้นคอนกรีตเสริมเหล็ก หนา 15 ซม. ขัดมันเรียบ', unit: 'ตร.ม.', qty: 1200, material: 520, labor: 180 },
  { item_no: '2.10', description: 'ลวดตาข่าย Wire Mesh 6 มม. @20 ซม.', unit: 'ตร.ม.', qty: 1200, material: 95, labor: 20 },
  { item_no: '3', description: 'งานระบบ', unit: null, qty: null, material: null, labor: null },
  { item_no: '3.1', description: 'ตู้ควบคุมไฟฟ้าหลัก MDB 400A', unit: 'ตู้', qty: 1, material: 185000, labor: 15000 },
  { item_no: '3.2', description: 'สายไฟ THW 1x95 ตร.มม.', unit: 'เมตร', qty: 320, material: 380, labor: 45 },
  { item_no: '3.3', description: 'โคมไฟไฮเบย์ LED 150W', unit: 'ชุด', qty: 36, material: 3200, labor: 650 },
  { item_no: '3.4', description: 'ท่อร้อยสาย EMT 1 นิ้ว พร้อมอุปกรณ์', unit: 'เมตร', qty: 640, material: 85, labor: 40 },
  { item_no: '3.5', description: 'ระบบดับเพลิง ถังเคมี 15 ปอนด์ พร้อมป้าย', unit: 'ชุด', qty: 12, material: 1800, labor: 200 },
  { item_no: '3.6', description: 'ท่อประปา PVC 2 นิ้ว ชั้น 13.5', unit: 'เมตร', qty: 150, material: 120, labor: 55 },
  { item_no: '3.7', description: 'สุขภัณฑ์ห้องน้ำคนงาน ครบชุด', unit: 'ห้อง', qty: 2, material: 18000, labor: 4500 },
  { item_no: '3.8', description: 'งานเดินสาย LAN และกล้องวงจรปิด 8 จุด', unit: 'ระบบ', qty: 1, material: 42000, labor: 12000 },
]

export const SAMPLE_SECTIONS = ['งานโครงสร้างเหล็ก', 'งานสถาปัตยกรรม', 'งานระบบ']
