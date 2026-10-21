import { describe, it, expect } from 'vitest'
import { reviewExtraction, normalizeUnit } from '@/lib/purchase/review'
import type { ExtractedDoc } from '@/lib/purchase/extract'

const boq = [
  { id: 'hb', description: 'เหล็ก H-BEAM - 200x200x8x12 mm.(49.9 kg/m.)SS400 (Size 6 m.)', unit: 'kg.' },
  { id: 'paint', description: 'สีรองพื้นกันสนิม', unit: 'แกลลอน' },
  { id: 'plate', description: 'เหล็กแผ่น 4x8 ฟุต หนา 6 mm', unit: 'kg' },
]

function doc(over: Partial<ExtractedDoc> = {}): ExtractedDoc {
  return {
    is_purchase_document: true, supplier_name: 'บจก.เหล็กใต้', document_no: 'PO-001', job_reference: null, project_index: null, document_date: '2026-10-17',
    prices_include_vat: false, subtotal: 92000, discount: null, vat: 6440, grand_total: 98440,
    lines: [
      { description: 'H-BEAM 200x200 6m', qty: 10, unit: 'เส้น', unit_price: 9000, line_total: 90000, boq_index: 0, qty_factor: null, match_note: null },
      { description: 'สีกันสนิม', qty: 2, unit: 'กล.', unit_price: 1000, line_total: 2000, boq_index: 1, qty_factor: null, match_note: null },
    ],
    warnings: [],
    ...over,
  }
}

describe('ตรวจและแปลงรายการที่ Claude อ่านจากเอกสารจัดซื้อ', () => {
  it('เอกสารที่ตัวเลขตรงกันทั้งหมด ไม่มีข้อผิดพลาด และใช้ตัวแปลงเหล็กจากชื่อรายการ BOQ', () => {
    const r = reviewExtraction(doc(), boq)
    expect(r.issues).toEqual([])
    expect(r.lines[0]).toMatchObject({ boq_item_id: 'hb', qty: 10, unit_price: 9000, qty_factor: 299.4 })
    expect(r.lines[0].note).toContain('49.9 kg/m × 6 m')
    expect(r.total_excl_vat).toBe(92000)
  })

  it('จับตัวเลขที่อ่านผิด: ยอดบรรทัด ผลรวม VAT และยอดสุทธิ', () => {
    const d = doc({ vat: 6000, grand_total: 99000 })
    d.lines[0].line_total = 95000
    const issues = reviewExtraction(d, boq).issues
    expect(issues.some(m => m.startsWith('บรรทัด 1') && m.includes('95,000.00'))).toBe(true)
    expect(issues.some(m => m.startsWith('ผลรวมรายการ 97,000.00'))).toBe(true)
    expect(issues.some(m => m.startsWith('VAT ในเอกสาร 6,000.00'))).toBe(true)
    expect(issues.some(m => m.startsWith('ยอดสุทธิในเอกสาร 99,000.00'))).toBe(true)
  })

  it('ส่วนลดท้ายบิลเฉลี่ยลงราคาต่อหน่วย และถอด VAT เมื่อราคาในเอกสารรวม VAT', () => {
    const r = reviewExtraction(doc({ prices_include_vat: true, subtotal: 92000, discount: 9200, vat: null, grand_total: 82800 }), boq)
    expect(r.issues).toEqual([])
    // 9,000 × 0.9 ÷ 1.07 = 7,570.09
    expect(r.lines[0].unit_price).toBe(7570.09)
    expect(r.notes.length).toBe(2)
  })

  it('หน่วยต่างกันแต่หาตัวแปลงไม่ได้ ให้ผู้ใช้กรอกเอง ตัวแปลงจาก Claude ใช้ได้แต่ต้องบอกให้ตรวจ', () => {
    const d = doc()
    d.lines.push({ description: 'เหล็กแผ่น 4x8 6mm', qty: 3, unit: 'แผ่น', unit_price: 5000, line_total: 15000, boq_index: 2, qty_factor: null, match_note: null })
    d.lines.push({ description: 'เหล็กแผ่น 4x8 6mm', qty: 1, unit: 'แผ่น', unit_price: 5000, line_total: 5000, boq_index: 2, qty_factor: 140.4, match_note: null })
    const r = reviewExtraction({ ...d, subtotal: null, vat: null, grand_total: null }, boq)
    expect(r.lines[2]).toMatchObject({ qty_factor: null })
    expect(r.lines[3].qty_factor).toBe(140.4)
    expect(r.lines[3].note).toContain('ตรวจก่อนบันทึก')
  })

  it('บรรทัดที่ไม่ตรงกับ BOQ หรือเลขรายการเกินช่วง ไม่ถูกจับคู่', () => {
    const d = doc()
    d.lines[1].boq_index = null
    d.lines[0].boq_index = 99
    const r = reviewExtraction(d, boq)
    expect(r.lines.map(l => l.boq_item_id)).toEqual([null, null])
  })

  it('หน่วยที่เขียนต่างกันแต่ความหมายเดียวกันถือว่าเป็นหน่วยเดียวกัน', () => {
    expect(normalizeUnit('kg.')).toBe(normalizeUnit('กก.'))
    expect(normalizeUnit('ตร.ม.')).toBe(normalizeUnit('m2'))
  })
})
