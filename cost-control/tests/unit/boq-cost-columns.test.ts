import { describe, it, expect } from 'vitest'
import { chooseLayout, templateHeaders } from '@/lib/boq/choose'
import { buildPreview, detectLayout } from '@/lib/boq/parse'
import { detectCostColumns, splitRows } from '@/lib/boq/split'
import { classifyLabel, verifySheet } from '@/lib/boq/verify'

// BOQ แบบ S-2000 ที่มีคอลัมน์ต้นทุนของผู้ประมาณราคาอยู่ด้านขวา (L ถึง O)
// หัวคอลัมน์ต้นทุนอยู่ในแถวหัวหมวด ไม่ใช่แถวหัวตาราง (ข้อมูลสมมติ)
function grid(): unknown[][] {
  return [
    ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL', 'REMARK'],
    ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL', 'REMARK'],
    ['1', 'งานรางน้ำ', '', '', '', '', '', '', '', '', '', 'ต้นทุนวัสดุ /หน่วย', 'ต้นทุนวัสดุ รวม', 'ต้นทุนค่าแรง/หน่วย', 'ต้นทุนค่าแรงรวม'],
    ['', 'แผ่นสแตนเลส', 10, 'pcs.', 3100, 31000, '', '', 3100, 31000, '', 2794.39, 27943.9, '', ''],
    ['', 'ค่าพับ', 5, 'pcs.', '', '', 320, 1600, 320, 1600, '', '', '', 280, 1400],
    ['', 'น็อต', 100, 'ตัว', 5, 500, '', '', 5, 500, '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', 'Total งานรางน้ำ', 33100, '', '', 27943.9, '', 1400],
  ]
}

describe('คอลัมน์ต้นทุนของผู้ประมาณราคา', () => {
  it('หาคอลัมน์ต้นทุนเจอแม้หัวคอลัมน์อยู่ในแถวหัวหมวด', () => {
    expect(detectCostColumns(grid())).toEqual({ material_cost: 11, material_cost_total: 12, labor_cost: 13, labor_cost_total: 14 })
  })

  it('งบใช้ต้นทุนจากคอลัมน์ต้นทุน ราคาในตาราง BOQ เป็นราคาขาย', () => {
    const r = chooseLayout('BOQ', grid(), null, null)
    expect(r.split.cost_mode).toBe(true)
    const sheet = r.split.items.find(i => i.description === 'แผ่นสแตนเลส')!
    expect(sheet).toMatchObject({ category: 'material', unit_cost: 2794.39, sell_unit_price: 3100 })
    expect(sheet.markup_pct).toBeCloseTo(10.94, 2)
    const fold = r.split.items.find(i => i.description === 'ค่าพับ')!
    expect(fold).toMatchObject({ category: 'labor', unit_cost: 280, sell_unit_price: 320 })
  })

  it('บรรทัดที่ไม่มีต้นทุนในไฟล์ ใช้ราคาขายเป็นต้นทุน และนับไว้เตือน', () => {
    const r = chooseLayout('BOQ', grid(), null, null)
    expect(r.split.missing_cost_items).toBe(1)
    expect(r.split.items.find(i => i.description === 'น็อต')).toMatchObject({ unit_cost: 5, sell_unit_price: 5 })
  })

  it('ผู้ใช้ปิดคอลัมน์ต้นทุนได้ กลับไปใช้ราคาในตารางเป็นต้นทุนเหมือนเดิม', () => {
    const r = chooseLayout('BOQ', grid(), null, null)
    const off = splitRows(r.preview.rows, { ...r.mapping, material_cost: null, labor_cost: null }, 0)
    expect(off.cost_mode).toBe(false)
    expect(off.items.find(i => i.description === 'แผ่นสแตนเลส')?.unit_cost).toBe(3100)
  })

  it('ตรวจตัวเลขในคอลัมน์ต้นทุน ทั้งรายบรรทัดและยอดรวมหมวด', () => {
    const r = chooseLayout('BOQ', grid(), null, null)
    expect(verifySheet(grid(), r.layout, r.mapping).issues).toEqual([])

    const g = grid()
    g[3][12] = 29000
    const issues = verifySheet(g, r.layout, r.mapping).issues
    expect(issues.map(i => i.row)).toEqual([4, 7])
    expect(issues[0].message).toContain('ต้นทุนวัสดุรวม 29,000.00')
  })
})

describe('คอลัมน์ต้นทุนที่จำไว้จากไฟล์ก่อน', () => {
  // ไฟล์ก่อนวางคอลัมน์ต้นทุนไว้ที่ U ถึง X ไฟล์นี้วางที่ L ถึง O ชื่อชีตเดียวกัน หัวตารางหลักเหมือนกัน
  // เคยทำให้ทุกรายการไม่มีต้นทุน ระบบใช้ราคาขายเป็นต้นทุน กำไรเป็นศูนย์ทุกบรรทัด
  const staleCost = { material_cost: 20, material_cost_total: 21, labor_cost: 22, labor_cost_total: 23 }

  it('template ใช้คอลัมน์ต้นทุนที่หาเจอในไฟล์นี้ ไม่ใช่ตำแหน่งจากไฟล์ก่อน', () => {
    const g = grid()
    const layout = detectLayout(g)
    const preview = buildPreview('BOQ', g, layout)
    const fresh = chooseLayout('BOQ', g, null, null)
    const columns = { ...fresh.mapping, ...staleCost }
    const tpl = { columns, layout, headers: templateHeaders(preview.headers, columns) }
    const r = chooseLayout('BOQ', g, tpl, null)
    expect(r.source).toBe('template')
    expect(r.mapping).toMatchObject({ material_cost: 11, labor_cost: 13 })
    expect(r.split.missing_cost_items).toBe(1)
    expect(r.split.items.find(i => i.description === 'แผ่นสแตนเลส')).toMatchObject({ unit_cost: 2794.39, sell_unit_price: 3100 })
  })

  it('Claude ชี้คอลัมน์ต้นทุนผิด ใช้คอลัมน์ที่หัวคอลัมน์บอกว่าเป็นต้นทุน', () => {
    const g = grid()
    const fresh = chooseLayout('BOQ', g, null, null)
    const r = chooseLayout('BOQ', g, null, { layout: fresh.layout, mapping: { ...fresh.mapping, ...staleCost }, is_boq_detail_sheet: true })
    expect(r.source).toBe('ai')
    expect(r.split.items.find(i => i.description === 'ค่าพับ')).toMatchObject({ unit_cost: 280, sell_unit_price: 320 })
  })
})

describe('ตัวเลขที่ผู้ประมาณราคาทดไว้ข้างตาราง', () => {
  it('แถว รวม ข้างตารางก่อนรายการแรก ไม่ถูกตรวจเป็นยอดต้นทุนหมวด', () => {
    const g = grid()
    g.splice(2, 0, ['', '', '', '', '', '', '', '', '', '', 'รวม', 33100, 29343.9, '', ''])
    const r = chooseLayout('BOQ', g, null, null)
    expect(verifySheet(g, r.layout, r.mapping).issues).toEqual([])
  })

  it('ยอดหลังบวกค่าดำเนินการเป็นยอดรวม ไม่ใช่ค่าดำเนินการอีกบรรทัด', () => {
    expect(classifyLabel('ราคารวมค่าดำเนินการ')).toBe('total')
    expect(classifyLabel('ค่าดำเนินการ+กำไร 12%')).toBe('overhead')
    expect(classifyLabel('รวมทั้งสิ้น')).toBe('total')
    expect(classifyLabel('รวมเงินทั้งสิ้น')).toBe('grand_total')
    expect(classifyLabel('ส่วนลด')).toBe('discount')
  })
})

describe('markup ที่คำนวณจากราคาขายเทียบต้นทุน', () => {
  it('ต้นทุนต่ำมากเทียบราคาขาย markup ไม่เกินช่องเก็บ ±9,999.99%', () => {
    const g: unknown[][] = [
      ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL'],
      ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL', '', 'ต้นทุนวัสดุ /หน่วย'],
      ['', 'น็อตยึด', 100, 'ตัว', 100, 10000, '', '', 100, 10000, '', 0.1],
    ]
    const r = chooseLayout('BOQ', g, null, null)
    expect(r.split.cost_mode).toBe(true)
    expect(r.split.items[0].markup_pct).toBe(9999.99)
    expect(r.split.items[0].unit_cost).toBe(0.1)
  })
})
