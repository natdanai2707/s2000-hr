import { describe, it, expect } from 'vitest'
import { chooseLayout, templateHeaders } from '@/lib/boq/choose'
import { buildPreview, detectLayout } from '@/lib/boq/parse'
import { autoDetectMapping } from '@/lib/boq/split'
import type { StoredTemplate } from '@/lib/boq/layout'

// ชีตชื่อ BOQ รูปแบบมาตรฐาน S-2000: หัวกระดาษ 3 แถว หัวตาราง 2 แถวที่แถว 4 (ข้อมูลสมมติ)
const s2000Grid: unknown[][] = [
  ['BILL OF QUANTITIES', '', 'PROJECT', 'งานรางน้ำสแตนเลส'],
  ['BILL OF QUANTITIES', '', 'LOCATION', 'นครศรีธรรมราช'],
  ['BILL OF QUANTITIES', '', 'OWNER', 'ลูกค้าทดสอบ'],
  ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL'],
  ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL'],
  ['1', 'งานรางน้ำ'],
  [null, 'รางน้ำสแตนเลส 304', 40, 'ม.', 850, 34000, 150, 6000, 1000, 40000],
  [null, 'ท่อลงสแตนเลส', 6, 'ชุด', 1200, 7200, 300, 1800, 1500, 9000],
]

// template ที่บันทึกจากไฟล์อื่นที่ชีตชื่อ BOQ เหมือนกัน แต่หัวตารางอยู่แถว 8 และคอลัมน์เลื่อนไป 1 ช่อง
const staleTemplate: StoredTemplate = {
  columns: { item_no: 1, description: 2, qty: 3, unit: 4, material_price: 5, labor_price: 7, total: 10 },
  layout: { header_row: 8, header_rows: 2, data_start_row: 10 },
}

describe('เลือกโครงชีตเมื่อมี template ชื่อชีตซ้ำ', () => {
  it('template จากไฟล์อื่นที่หัวตารางไม่ตรง ถูกข้าม และยังแตกรายการได้ครบ', () => {
    const r = chooseLayout('BOQ', s2000Grid, staleTemplate, null)
    expect(r.template_rejected).toBe(true)
    expect(r.source).toBe('rules')
    expect(r.split.items.length).toBe(4)
    expect(r.split.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)).toBe(49000)
  })

  it('Claude อ่านไฟล์ใหม่ทุกครั้ง ผลของ Claude มาก่อน template ที่จำจากไฟล์ก่อน', () => {
    const layout = detectLayout(s2000Grid)
    const mapping = autoDetectMapping(buildPreview('BOQ', s2000Grid, layout).headers)
    const r = chooseLayout('BOQ', s2000Grid, staleTemplate, { layout, mapping, is_boq_detail_sheet: true })
    expect(r.source).toBe('ai')
    const tpl: StoredTemplate = { columns: mapping, layout, headers: templateHeaders(buildPreview('BOQ', s2000Grid, layout).headers, mapping) }
    expect(chooseLayout('BOQ', s2000Grid, tpl, { layout, mapping, is_boq_detail_sheet: true }).source).toBe('ai')
  })

  it('template ที่ไม่ตรงกับไฟล์ ถูกข้ามเมื่อ Claude ไม่ทำงาน', () => {
    const r = chooseLayout('BOQ', s2000Grid, staleTemplate, null)
    expect(r.source).toBe('rules')
    expect(r.template_rejected).toBe(true)
  })

  it('template ที่บันทึกจากไฟล์หน้าตาเดียวกัน (หัวคอลัมน์ตรง) ยังถูกใช้', () => {
    const layout = detectLayout(s2000Grid)
    const preview = buildPreview('BOQ', s2000Grid, layout)
    const mapping = autoDetectMapping(preview.headers)
    const tpl: StoredTemplate = { columns: mapping, layout, headers: templateHeaders(preview.headers, mapping) }
    const r = chooseLayout('BOQ', s2000Grid, tpl, null)
    expect(r.source).toBe('template')
    expect(r.template_rejected).toBe(false)
  })

  it('template ที่หัวคอลัมน์ตรงแถว แต่คอลัมน์ราคาถูกสลับ ไม่ถูกใช้ เพราะตัวเลขจะผิดทั้งชีต', () => {
    const layout = detectLayout(s2000Grid)
    const preview = buildPreview('BOQ', s2000Grid, layout)
    const mapping = autoDetectMapping(preview.headers)
    const tpl: StoredTemplate = { columns: { ...mapping, material_price: 5 }, layout, headers: templateHeaders(preview.headers, mapping) }
    const r = chooseLayout('BOQ', s2000Grid, tpl, null)
    expect(r.source).not.toBe('template')
  })

  it('Claude บอกว่าไม่ใช่ชีตรายละเอียด BOQ ไม่ไล่หาแหล่งอื่นมาแตกรายการ', () => {
    const layout = detectLayout(s2000Grid)
    const r = chooseLayout('ปก', s2000Grid, null, { layout, mapping: {}, is_boq_detail_sheet: false })
    expect(r.source).toBe('ai')
    expect(r.split.items).toHaveLength(0)
  })
})
