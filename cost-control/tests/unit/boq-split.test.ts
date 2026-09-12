import { describe, it, expect } from 'vitest'
import { splitRows, autoDetectMapping, summarize, cellNumber, cellText } from '@/lib/boq/split'

// รูปแบบ BOQ มาตรฐาน S-2000: ลำดับ รายการ หน่วย ปริมาณ ราคาวัสดุ ราคาแรงงาน รวม
const headers = ['ลำดับ', 'รายการ', 'หน่วย', 'ปริมาณ', 'ราคาวัสดุ', 'ค่าแรง', 'รวม']
const mapping = autoDetectMapping(headers)

describe('autoDetectMapping', () => {
  it('จับคู่คอลัมน์มาตรฐาน S-2000 ได้ครบ', () => {
    expect(mapping).toMatchObject({ item_no: 0, description: 1, unit: 2, qty: 3, material_price: 4, labor_price: 5, total: 6 })
  })
})

describe('splitRows: แตกแถววัสดุ/แรงงาน', () => {
  const rows: unknown[][] = [
    ['1', 'งานโครงสร้าง', null, null, null, null, null],
    ['1.1', 'เหล็ก H-Beam 200x200', 'ตัน', 10, 30000, 2000, 320000],
    ['1.2', 'ค่าแรงเชื่อมประกอบ', 'ตัน', 10, null, 3500, 35000],
    ['1.3', 'สีกันสนิม', 'ถัง', 5, 1200, 0, 6000],
    ['2', 'งานสถาปัตย์', '', '', '', '', ''],
    ['2.1', 'แผ่นเมทัลชีท', 'ตร.ม.', 200, 350, 80, 86000],
    ['', 'รวมทั้งสิ้น', null, null, null, null, 447000],
  ]

  it('แถวที่ไม่มีปริมาณกลายเป็นหมวด', () => {
    const r = splitRows(rows, mapping)
    expect(r.sections.map(s => s.name)).toEqual(['งานโครงสร้าง', 'งานสถาปัตย์'])
    expect(r.sections[0].code).toBe('1')
  })

  it('แถวที่มีราคาวัสดุและแรงงานแยกกันแตกเป็น 2 items item_no เดียวกัน', () => {
    const r = splitRows(rows, mapping)
    const hbeam = r.items.filter(i => i.item_no === '1.1')
    expect(hbeam).toHaveLength(2)
    expect(hbeam.map(i => i.category).sort()).toEqual(['labor', 'material'])
    expect(hbeam.find(i => i.category === 'material')!.unit_cost).toBe(30000)
    expect(hbeam.find(i => i.category === 'labor')!.unit_cost).toBe(2000)
    expect(hbeam.every(i => i.qty === 10 && i.section_index === 0)).toBe(true)
  })

  it('แถวที่มีแค่ค่าแรงเป็น labor รายการเดียว และแค่วัสดุเป็น material รายการเดียว', () => {
    const r = splitRows(rows, mapping)
    expect(r.items.filter(i => i.item_no === '1.2')).toEqual([expect.objectContaining({ category: 'labor', unit_cost: 3500 })])
    expect(r.items.filter(i => i.item_no === '1.3')).toEqual([expect.objectContaining({ category: 'material', unit_cost: 1200 })])
  })

  it('ข้ามแถวสรุปรวมที่ไม่มีลำดับและไม่มีปริมาณ', () => {
    const r = splitRows(rows, mapping)
    expect(r.items.some(i => i.description === 'รวมทั้งสิ้น')).toBe(false)
    expect(r.sections.some(s => s.name === 'รวมทั้งสิ้น')).toBe(false)
    expect(r.skipped).toBe(1)
  })

  it('ผูกรายการกับหมวดล่าสุด และคำนวณราคาขายจาก markup', () => {
    const r = splitRows(rows, mapping, 10)
    const sheet = r.items.find(i => i.item_no === '2.1' && i.category === 'material')!
    expect(sheet.section_index).toBe(1)
    expect(sheet.markup_pct).toBe(10)
    expect(sheet.sell_unit_price).toBe(385)
  })

  it('แถวที่มีแต่ยอดรวม ใช้ total / qty เป็นต้นทุนต่อหน่วย', () => {
    const r = splitRows([['3.1', 'งานเหมา', 'งาน', 2, null, null, 5000]], mapping)
    expect(r.items[0]).toMatchObject({ category: 'material', unit_cost: 2500 })
  })

  it('summarize รวมต้นทุน ราคาขาย กำไร แยกหมวด', () => {
    const r = splitRows(rows, mapping, 10)
    const s = summarize(r)
    expect(s.cost).toBeCloseTo(447000, 2)
    expect(s.sell).toBeCloseTo(491700, 2)
    expect(s.profit).toBeCloseTo(44700, 2)
    expect(s.profit_pct).toBeCloseTo((44700 / 491700) * 100, 6)
    expect(s.sections.map(x => x.name)).toEqual(['งานโครงสร้าง', 'งานสถาปัตย์'])
  })
})

describe('cell helpers', () => {
  it('อ่านตัวเลขที่มีลูกน้ำ สูตร และ richText', () => {
    expect(cellNumber('1,234.5')).toBe(1234.5)
    expect(cellNumber({ result: 42 })).toBe(42)
    expect(cellNumber('')).toBeNull()
    expect(cellText({ richText: [{ text: 'เหล็ก' }, { text: ' H-Beam' }] })).toBe('เหล็ก H-Beam')
  })
})
