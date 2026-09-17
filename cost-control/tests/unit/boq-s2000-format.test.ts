import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { parseWorkbook } from '@/lib/boq/parse'
import { autoDetectMapping, splitRows, type SplitResult, type ColumnMapping } from '@/lib/boq/split'
import type { SheetPreview } from '@/lib/boq/parse'

// จำลองรูปแบบ BOQ มาตรฐานของ S-2000 ตามไฟล์จริง (ข้อมูลสมมติ)
// โครงสร้าง: หัวกระดาษ 3 แถว, หัวตาราง 2 แถว (กลุ่ม + @/SUB TOTAL),
// บล็อก SUMMARY สรุปยอดต่อหมวด, หมายเหตุ, แล้วจึงเป็นรายละเอียดจริง
async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('งานทดสอบ')
  const banner = (text: string, total: number) => [text, text, text, text, text, text, text, text, text, total]

  ws.addRow(['BILL OF QUANTITIES', 'BILL OF QUANTITIES', 'PROJECT', 'PROJECT', 'งานทดสอบระบบ', '', '', '', 'JOB No.', 'SA69-09/999'])
  ws.addRow(['BILL OF QUANTITIES', 'BILL OF QUANTITIES', 'LOCATION', 'LOCATION', 'หาดใหญ่', '', '', '', 'ESTIMATOR', 'ผู้ประมาณราคา'])
  ws.addRow(['BILL OF QUANTITIES', 'BILL OF QUANTITIES', 'OWNER', 'OWNER', 'ลูกค้าทดสอบ', '', '', '', 'CHECKED BY', 'ผู้ตรวจ'])
  ws.addRow(['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL', 'REMARK'])
  ws.addRow(['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL', 'REMARK'])
  ws.addRow([null, 'SUMMARY', 'PROJECT'])
  ws.addRow([null, 'งานทดสอบระบบ'])
  ws.addRow(['A', 'หมวดงานโครงสร้าง', 1, 'L/S', null, null, null, null, 15400, 15400])
  ws.addRow(['B', 'หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด', 1, 'L/S', null, null, null, null, 9000, 9000])
  ws.addRow(banner('Sub Total งานทดสอบระบบ', 24400))
  ws.addRow(banner('Total งานทดสอบระบบ', 24400))
  ws.addRow([null, null, null, null, null, 'สองหมื่นสี่พันสี่ร้อยบาทถ้วน'])
  ws.addRow([null, 'หมายเหตุ'])
  ws.addRow([null, '1.ไม่รวมงานระบบไฟฟ้า'])
  ws.addRow([])
  ws.addRow(['A', 'หมวดงานโครงสร้าง'])
  ws.addRow(['1', 'งานฐานราก'])
  ws.addRow([null, 'ดินขุด-ดินถม', 10, 'คิว', 'By Owner', 'By Owner', 240, 2400, 240, 2400])
  ws.addRow([null, 'คอนกรีตโครงสร้าง', 5, 'คิว', 2000, 10000, 600, 3000, 2600, 13000])
  ws.addRow([null, null, null, null, null, null, null, null, 'Total งานฐานราก', 15400])
  ws.addRow(['B', 'หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด'])
  ws.addRow(['1', 'งานผนัง'])
  ws.addRow([null, 'ก่ออิฐมอญ', 20, 'ตร.ม', 300, 6000, 150, 3000, 450, 9000])
  ws.addRow([null, 'รวมทั้งสิ้น', null, null, null, null, null, null, null, 24400])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('รูปแบบ BOQ มาตรฐาน S-2000 (หัวตาราง 2 แถว + บล็อก SUMMARY)', () => {
  let sheet: SheetPreview
  let mapping: ColumnMapping
  let result: SplitResult

  beforeAll(async () => {
    const sheets = await parseWorkbook(await buildWorkbook())
    sheet = sheets[0]
    mapping = autoDetectMapping(sheet.headers)
    result = splitRows(sheet.rows, mapping, 0)
  })

  it('ข้ามหัวกระดาษแล้วหาแถวหัวตารางเจอ พร้อมรู้ว่าเป็นหัวตาราง 2 แถว', () => {
    expect(sheet.header_row).toBe(4)
    expect(sheet.header_rows).toBe(2)
  })

  it('รวมหัวตาราง 2 แถวเพื่อแยกราคาต่อหน่วยออกจากยอดรวมของหมวดเดียวกัน', () => {
    expect(sheet.headers[4]).toBe('MATERIAL @')
    expect(sheet.headers[5]).toBe('MATERIAL SUB TOTAL')
    expect(sheet.headers[6]).toBe('LABOUR @')
    expect(sheet.headers[7]).toBe('LABOUR SUB TOTAL')
  })

  it("จับคู่ Q'TY และ ITEMS ได้ และไม่เอา SUB TOTAL มาเป็นราคาต่อหน่วย", () => {
    expect(mapping).toMatchObject({
      item_no: 0,
      description: 1,
      qty: 2,
      unit: 3,
      material_price: 4,
      labor_price: 6,
      total: 9,
    })
  })

  it('ไม่นับบล็อก SUMMARY ซ้ำกับรายละเอียดด้านล่าง', () => {
    expect(result.items.some(i => i.description.startsWith('หมวดงาน'))).toBe(false)
    const cost = result.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
    expect(cost).toBe(24400) // เท่ากับ Sub Total ในไฟล์ ไม่ถูกบวกซ้ำจากบล็อกสรุป
  })

  it('ข้ามแถวสรุปที่ merge ทั้งแถว (Sub Total / Total) และแถวหมายเหตุ', () => {
    const names = result.sections.map(s => s.name).concat(result.items.map(i => i.description))
    expect(names.some(n => /^(sub\s*total|total|หมายเหตุ|รวมทั้งสิ้น)/i.test(n))).toBe(false)
  })

  it('ช่องราคาที่เขียนว่า By Owner ถือว่าต้นทุนของเราเป็นศูนย์ ไม่ใช่ราคาต่อหน่วย', () => {
    const dig = result.items.filter(i => i.description === 'ดินขุด-ดินถม')
    expect(dig).toHaveLength(1)
    expect(dig[0]).toMatchObject({ category: 'labor', unit_cost: 240, qty: 10 })
  })

  it('แตกวัสดุกับค่าแรงเป็นสองรายการตามเดิม', () => {
    const concrete = result.items.filter(i => i.description === 'คอนกรีตโครงสร้าง')
    expect(concrete.map(i => [i.category, i.unit_cost]).sort()).toEqual([
      ['labor', 600],
      ['material', 2000],
    ])
  })

  it('หมวดใช้ชื่อกลุ่มย่อย และเก็บหมวดใหญ่ไว้ใน code', () => {
    expect(result.sections.map(s => [s.code, s.name])).toEqual([
      ['หมวดงานโครงสร้าง', 'งานฐานราก'],
      ['หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด', 'งานผนัง'],
    ])
  })

  it('เตือนเมื่อพบหัวข้อที่เป็นงานลดของ VO', () => {
    expect(result.deduction_headings).toEqual(['หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด'])
  })
})
