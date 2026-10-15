import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { parseWorkbook, type SheetPreview } from '@/lib/boq/parse'
import { autoDetectMapping, splitRows, type ColumnMapping, type SplitResult } from '@/lib/boq/split'

// จำลองใบเสนอราคาที่มีบล็อกคำนวณต้นทุนอยู่ด้านข้าง ตามไฟล์จริงที่ทำให้กำไรคาดหวังเพี้ยน
// คอลัมน์ "ราคา+5%" เคยถูกจับเป็น markup เพราะชื่อมีเครื่องหมาย % ทำให้ markup กลายเป็น 6182.24%
async function buildQuotation(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('ใบเสนอราคา')
  ws.addRow(['We are pleased to quote you as following'])
  ws.addRow([])
  ws.addRow([
    'Item', 'Description', 'Qty', 'Unit', 'Price/Unit', 'Total',
    'ราคาถอด Vat', 'ราคา+5%', 'ต้นทุนวัสดุ/หน่วย', 'ต้นทุนวัสดุ รวม',
  ])
  ws.addRow([null, '6-10-69'])
  ws.addRow([
    1, "ตะแกรงสแตนเลสอีก XS-63 หนา 4.50 มม. 5' x 10'", 20, 'แผ่น', 6185, 123700,
    5887.85, 6182.24, 5887.85, 117757,
  ])
  ws.addRow([null, '(รอผลิต 7-14 วัน)'])
  ws.addRow([null, null, null, null, 'Total', 123700])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// คอลัมน์ชื่อ markup จริง แต่ค่าข้างในเป็นราคา ต้องถูกปฏิเสธทั้งคอลัมน์
async function buildBadMarkupColumn(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('BOQ')
  ws.addRow(['ลำดับ', 'รายการ', 'หน่วย', 'ปริมาณ', 'ราคาวัสดุ', 'ค่าแรง', 'markup'])
  ws.addRow(['1', 'เหล็ก H-Beam', 'ตัน', 10, 30000, 2000, 31500])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('ใบเสนอราคาที่มีคอลัมน์ราคาซึ่งมี % อยู่ในชื่อ', () => {
  let sheet: SheetPreview
  let mapping: ColumnMapping
  let result: SplitResult

  beforeAll(async () => {
    sheet = (await parseWorkbook(await buildQuotation()))[0]
    mapping = autoDetectMapping(sheet.headers)
    result = splitRows(sheet.rows, mapping, 5)
  })

  it('ไม่จับคอลัมน์ "ราคา+5%" เป็น markup', () => {
    expect(mapping.markup_pct).toBeUndefined()
  })

  it('จับคอลัมน์ต้นทุนวัสดุต่อหน่วยถูก ไม่ใช่ราคาขาย', () => {
    expect(sheet.headers[mapping.material_price as number]).toBe('ต้นทุนวัสดุ/หน่วย')
  })

  it('ใช้ markup ค่าเริ่มต้นที่ผู้ใช้กรอก แทนตัวเลขจากคอลัมน์ที่จับผิด', () => {
    const item = result.items.find(i => i.description.startsWith('ตะแกรง'))!
    expect(item.markup_pct).toBe(5)
    expect(item.unit_cost).toBe(5887.85)
    expect(item.qty).toBe(20)
    expect(item.sell_unit_price).toBe(6182.24)
  })

  it('ต้นทุนรวมและกำไรคาดหวังอยู่ในระดับที่สมเหตุสมผล', () => {
    const cost = result.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
    const sell = result.items.reduce((s, i) => s + i.qty * i.sell_unit_price, 0)
    expect(cost).toBeCloseTo(117757, 2)
    expect((sell - cost) / sell).toBeLessThan(0.2)
  })

  it('บรรทัดที่เป็นวันที่ล้วนไม่กลายเป็นหมวด', () => {
    expect(result.sections.map(s => s.name)).not.toContain('6-10-69')
  })
})

describe('คอลัมน์ markup ที่ค่าไม่ใช่เปอร์เซ็นต์', () => {
  it('ถูกปฏิเสธทั้งคอลัมน์ และแจ้งกลับให้หน้านำเข้าเตือนผู้ใช้', async () => {
    const sheet = (await parseWorkbook(await buildBadMarkupColumn()))[0]
    const mapping = autoDetectMapping(sheet.headers)
    expect(mapping.markup_pct).toBe(6)
    const result = splitRows(sheet.rows, mapping, 10)
    expect(result.markup_column_rejected).toBe(true)
    expect(result.items.every(i => i.markup_pct === 10)).toBe(true)
  })

  it('ยอมรับคอลัมน์ markup ที่ค่าเป็นเปอร์เซ็นต์ปกติ', () => {
    const rows: unknown[][] = [['1', 'เหล็ก', 'ตัน', 10, 30000, 2000, 12]]
    const result = splitRows(rows, { item_no: 0, description: 1, unit: 2, qty: 3, material_price: 4, labor_price: 5, markup_pct: 6 }, 0)
    expect(result.markup_column_rejected).toBe(false)
    expect(result.items[0].markup_pct).toBe(12)
    expect(result.items[0].sell_unit_price).toBe(33600)
  })
})
