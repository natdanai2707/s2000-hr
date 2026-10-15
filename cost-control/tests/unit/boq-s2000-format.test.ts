import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { parseWorkbook } from '@/lib/boq/parse'
import { autoDetectMapping, splitRows, summarize, type SplitResult, type ColumnMapping } from '@/lib/boq/split'
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
  ws.addRow(banner('Sub Total งานทดสอบระบบ', 6400))
  ws.addRow(banner('Total งานทดสอบระบบ', 6400))
  ws.addRow([null, null, null, null, null, 'หกพันสี่ร้อยบาทถ้วน'])
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
  ws.addRow([null, 'รวมทั้งสิ้น', null, null, null, null, null, null, null, 6400])
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
    // เท่ากับ Sub Total ในไฟล์ (งานเพิ่ม 15,400 หักงานลด 9,000) ไม่ถูกบวกซ้ำจากบล็อกสรุป
    expect(cost).toBe(6400)
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

  it('รายการใต้หัวข้องานลดเป็นปริมาณติดลบ ราคาต่อหน่วยยังเป็นบวก', () => {
    expect(result.deduction_headings).toEqual(['หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด'])
    const wall = result.items.filter(i => i.description === 'ก่ออิฐมอญ')
    expect(wall.map(i => [i.category, i.qty, i.unit_cost]).sort()).toEqual([
      ['labor', -20, 150],
      ['material', -20, 300],
    ])
    expect(result.deduction_items).toBe(2)
    expect(result.items.filter(i => i.description !== 'ก่ออิฐมอญ').every(i => i.qty > 0)).toBe(true)
  })
})

describe('งานลดใน VO', () => {
  const mapping: ColumnMapping = { item_no: 0, description: 1, qty: 2, unit: 3, material_price: 4, labor_price: 5 }

  it('กลับเป็นปริมาณบวกเมื่อเจอหมวดใหญ่ใหม่ที่ไม่ใช่งานลด', () => {
    const r = splitRows(
      [
        ['B', 'หมวดงานสถาปัตย์ งานลด'],
        ['1', 'งานผนัง'],
        [null, 'ก่ออิฐ', 10, 'ตร.ม', 300, 0],
        ['2', 'งานฝ้า'],
        [null, 'ฝ้ายิปซัม', 4, 'ตร.ม', 200, 0],
        ['C', 'หมวดงานเพิ่ม'],
        ['1', 'งานหลังคา'],
        [null, 'เมทัลชีท', 5, 'ตร.ม', 400, 0],
      ],
      mapping
    )
    expect(r.items.map(i => [i.description, i.qty])).toEqual([
      ['ก่ออิฐ', -10],
      ['ฝ้ายิปซัม', -4], // หมวดย่อยถัดไปยังอยู่ใต้หัวข้องานลดเดิม
      ['เมทัลชีท', 5],
    ])
    expect(summarize(r).cost).toBe(-3000 - 800 + 2000)
  })

  it('ไฟล์ที่เขียนเครื่องหมายลบไว้เองไม่ถูกกลับเป็นบวก ไม่ว่าจะอยู่ช่องปริมาณหรือช่องราคา', () => {
    const r = splitRows(
      [
        ['A', 'รายการลด'],
        [null, 'ประตูไม้', -2, 'ชุด', 5000, 0],
        [null, 'หน้าต่าง', 3, 'ชุด', -1000, 0],
      ],
      mapping
    )
    expect(r.items.map(i => [i.qty, i.unit_cost])).toEqual([
      [-2, 5000],
      [-3, 1000],
    ])
  })

  it('งานที่มีคำว่าลดอยู่ในชื่อจริงอย่างงานลดระดับพื้น ไม่ถูกนับเป็นงานลด', () => {
    const r = splitRows(
      [
        ['A', 'งานลดระดับพื้นห้องน้ำ'],
        [null, 'สกัดพื้น', 6, 'ตร.ม', 0, 250],
      ],
      mapping
    )
    expect(r.deduction_headings).toEqual([])
    expect(r.items[0].qty).toBe(6)
  })
})
