import { describe, it, expect } from 'vitest'
import { verifySheet, suggestContract, classifyLabel, type SummaryKind } from '@/lib/boq/verify'
import { detectLayout, buildPreview } from '@/lib/boq/parse'
import { autoDetectMapping } from '@/lib/boq/split'

// BOQ แบบ S-2000: บล็อก SUMMARY ด้านบน แล้วรายละเอียด (ข้อมูลสมมติ ตัวเลขถูกต้องทั้งหมด)
function s2000(): unknown[][] {
  return [
    ['BILL OF QUANTITIES', '', 'PROJECT', 'งานทดสอบ'],
    ['BILL OF QUANTITIES', '', 'OWNER', 'ลูกค้าทดสอบ'],
    ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL'],
    ['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL'],
    ['', 'SUMMARY', 'PROJECT'],
    ['A', 'หมวดงานราง', 1, 'L/S', '', '', '', '', 49000, 49000],
    ['Sub Total งานทดสอบ', 'Sub Total งานทดสอบ', '', '', '', '', '', '', '', 49000],
    ['Overhead & Profit 8%', 'Overhead & Profit 8%', '', '', '', '', '', '', '', 3920],
    ['Total งานทดสอบ', 'Total งานทดสอบ', '', '', '', '', '', '', '', 52920],
    ['A', 'หมวดงานราง'],
    ['1', 'งานรางน้ำ'],
    ['', 'รางสแตนเลส', 40, 'ม.', 850, 34000, 150, 6000, 1000, 40000],
    ['', 'ท่อลง', 6, 'ชุด', 1200, 7200, 300, 1800, 1500, 9000],
    ['', '', '', '', '', '', '', '', 'Total งานรางน้ำ', 49000],
  ]
}

function check(grid: unknown[][]) {
  const layout = detectLayout(grid)
  return verifySheet(grid, layout, autoDetectMapping(buildPreview('BOQ', grid, layout).headers))
}

describe('ตรวจตัวเลขใน BOQ', () => {
  it('ไฟล์ที่คำนวณถูกทั้งหมด ไม่มีข้อผิดพลาด และได้ยอด Total หลังค่าดำเนินการ', () => {
    const r = check(s2000())
    expect(r.issues).toEqual([])
    expect(r.checked).toBeGreaterThan(8)
    expect(r.contract).toMatchObject({ amount: 52920, before_vat: false })
  })

  it('จับรวมค่าวัสดุและยอดบรรทัดที่คูณผิด', () => {
    const g = s2000()
    g[11][5] = 35000
    g[11][9] = 41000
    const msgs = check(g).issues.map(i => `r${i.row} ${i.message}`)
    expect(msgs).toContain('r12 รวมค่าวัสดุ 35,000.00 แต่ 40 × 850.00 = 34,000.00')
    expect(msgs).toContain('r12 ยอดรวมบรรทัด 41,000.00 แต่ 40 × 1,000.00 = 40,000.00')
  })

  it('จับราคาต่อหน่วยรวมที่ไม่เท่าวัสดุบวกค่าแรง', () => {
    const g = s2000()
    g[12][8] = 1600
    expect(check(g).issues.some(i => i.row === 13 && i.message.startsWith('ราคาต่อหน่วยรวม 1,600.00'))).toBe(true)
  })

  it('จับยอดรวมหมวดที่บวกขาด และ Sub Total ที่ไม่ตรงผลรวมรายการ', () => {
    const g = s2000()
    g[13][9] = 40000
    g[6][9] = 48000
    const rows = check(g).issues.map(i => i.row)
    expect(rows).toContain(14)
    expect(rows).toContain(7)
  })

  it('จับค่าดำเนินการที่ไม่ตรงเปอร์เซ็นต์ และยอด Total ที่บวกผิด', () => {
    const g = s2000()
    g[7][9] = 3500
    const issues = check(g).issues
    expect(issues.find(i => i.row === 8)?.expected).toBe(3920)
    expect(issues.find(i => i.row === 9)?.expected).toBe(52500)
  })

  it('ป้ายแถวจาก Claude: บรรทัดหมวดในบล็อกสรุป และตัวเลขที่คำนวณเล่นนอกตาราง ไม่ถูกนับเป็นยอดผิด', () => {
    // จำลองไฟล์ V098: Claude ติดป้าย section_total ให้บรรทัด "A หมวดงานราง" ในบล็อกสรุป (แถว 6)
    // และติดป้าย vat ให้แถวหมายเหตุที่มี "Vat 56,624.40" อยู่คอลัมน์ M นอกตาราง
    const g = s2000()
    g.splice(9, 0, ['หมายเหตุ', '', '', '', '', '', '', '', '', '', '', '', 'Vat', 56624.4])
    const layout = detectLayout(g)
    const mapping = autoDetectMapping(buildPreview('BOQ', g, layout).headers)
    const roles = new Map<number, SummaryKind>([
      [6, 'section_total'],
      [7, 'sub_total'],
      [8, 'overhead'],
      [9, 'total'],
      [10, 'vat'],
      [15, 'section_total'],
    ])
    const r = verifySheet(g, { ...layout, data_start_row: 11 }, mapping, { roles })
    expect(r.issues).toEqual([])
    expect(r.contract?.amount).toBe(52920)
  })

  it('ใบเสนอราคาที่มีส่วนลดและ VAT: มูลค่าสัญญาคือยอดหลังส่วนลดก่อน VAT', () => {
    const q: unknown[][] = [
      ['', 'ลำดับ', 'รายละเอียด', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'จำนวนเงิน'],
      ['', '1', 'งานรางน้ำ', 1, 'L/S', 52920, 52920],
      ['', '', '', 'รวม', '', '', 52920],
      ['', '', '', 'ส่วนลด', '', '', 2920],
      ['', '', '', 'รวมทั้งสิ้น', '', '', 50000],
      ['', '', '', 'VAT 7%', '', '', 3500],
    ]
    const layout = detectLayout(q)
    const r = verifySheet(q, layout, autoDetectMapping(buildPreview('ใบเสนอราคา', q, layout).headers))
    expect(r.issues).toEqual([])
    expect(r.contract).toMatchObject({ amount: 50000, before_vat: true })

    q[5][6] = 3600
    const bad = verifySheet(q, layout, autoDetectMapping(buildPreview('ใบเสนอราคา', q, layout).headers))
    expect(bad.issues.map(i => i.row)).toEqual([6])
  })

  it('ใบเสนอราคาที่บวกค่าดำเนินการแล้วมีบรรทัดราคารวมค่าดำเนินการ ก่อนหักส่วนลด', () => {
    const q: unknown[][] = [
      ['', 'ลำดับ', 'รายละเอียด', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'จำนวนเงิน'],
      ['', '1', 'งานหลังคา', 1, 'L/S', 500000, 500000],
      ['', '', '', 'รวม', '', '', 500000],
      ['', '', '', 'ค่าดำเนินการ+กำไร 12%', '', '', 60000],
      ['', '', '', 'ราคารวมค่าดำเนินการ', '', '', 560000],
      ['', '', '', 'ส่วนลด', '', '', 2000],
      ['', '', '', 'รวมทั้งสิ้น', '', '', 558000],
      ['', '', '', 'VAT 7%', '', '', 39060],
    ]
    const layout = detectLayout(q)
    const r = verifySheet(q, layout, autoDetectMapping(buildPreview('ใบเสนอราคา', q, layout).headers))
    expect(r.issues).toEqual([])
    expect(r.contract).toMatchObject({ amount: 558000, before_vat: true })
  })

  it('เลือกมูลค่าสัญญาจากใบเสนอราคาก่อนชีตรายละเอียด', () => {
    const s = suggestContract([
      { name: 'BOQ', is_detail: true, included: true, contract: { amount: 52920, row: 9, label: 'Total', before_vat: false, source: 'rules' } },
      { name: 'ใบเสนอราคา', is_detail: false, included: false, contract: { amount: 50000, row: 5, label: 'รวมทั้งสิ้น', before_vat: true, source: 'rules' } },
    ])
    expect(s).toMatchObject({ amount: 50000, sheet: 'ใบเสนอราคา' })
  })

  it('ไม่มีใบเสนอราคา รวมยอดสุดท้ายของชีตรายละเอียดที่นำเข้า', () => {
    const s = suggestContract([
      { name: 'งานหลังคา', is_detail: true, included: true, contract: { amount: 100, row: 9, label: 'Total', before_vat: false, source: 'rules' } },
      { name: 'งานราง', is_detail: true, included: true, contract: { amount: 50.5, row: 9, label: 'Total', before_vat: false, source: 'rules' } },
      { name: 'งานไม่นำเข้า', is_detail: true, included: false, contract: { amount: 999, row: 9, label: 'Total', before_vat: false, source: 'rules' } },
    ])
    expect(s?.amount).toBe(150.5)
  })

  it('จำแนกแถวยอดรวมจากข้อความ', () => {
    expect(classifyLabel('Sub Total งานราง')).toBe('sub_total')
    expect(classifyLabel('Overhead & Profit 8%')).toBe('overhead')
    expect(classifyLabel('ส่วนลดพิเศษ')).toBe('discount')
    expect(classifyLabel('VAT 7%')).toBe('vat')
    expect(classifyLabel('รวมทั้งสิ้น')).toBe('total')
    expect(classifyLabel('รางสแตนเลส')).toBeNull()
  })
})
