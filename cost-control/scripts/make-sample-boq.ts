// สร้างไฟล์ BOQ ตัวอย่าง docs/samples/boq-sample.xlsx สำหรับทดสอบหน้านำเข้า
import ExcelJS from 'exceljs'
import path from 'node:path'
import { SAMPLE_BOQ } from './boq-sample-data'

async function main() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('BOQ')
  ws.addRow(['บริษัท เอส-2000 สตีล แฟบริเคท จำกัด'])
  ws.addRow(['ใบแสดงปริมาณและราคา (BOQ) โครงการโรงงานผลิตชิ้นส่วน อาคาร A'])
  ws.addRow([])
  ws.addRow(['ลำดับ', 'รายการ', 'หน่วย', 'ปริมาณ', 'ราคาวัสดุ', 'ค่าแรง', 'รวม'])
  for (const r of SAMPLE_BOQ) {
    const total = r.qty === null ? null : r.qty * ((r.material ?? 0) + (r.labor ?? 0))
    ws.addRow([r.item_no, r.description, r.unit, r.qty, r.material, r.labor, total])
  }
  const grand = SAMPLE_BOQ.reduce((s, r) => s + (r.qty ?? 0) * ((r.material ?? 0) + (r.labor ?? 0)), 0)
  ws.addRow(['', 'รวมทั้งสิ้น', null, null, null, null, grand])
  ws.columns = [{ width: 8 }, { width: 48 }, { width: 8 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 }]
  const out = path.resolve(__dirname, '../docs/samples/boq-sample.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('เขียนไฟล์', out)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
