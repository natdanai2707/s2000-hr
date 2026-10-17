import { describe, it, expect } from 'vitest'
import { suggestConversion, toBoqUnits } from '@/lib/units'

describe('แปลงหน่วยที่ซื้อกับหน่วย BOQ', () => {
  it('เหล็ก H-BEAM ที่ BOQ คิดเป็นกิโล เสนอ 1 เส้น = น้ำหนักต่อเมตร × ความยาว', () => {
    expect(suggestConversion('เหล็ก H-BEAM - 200x200x8x12 mm.(49.9 kg/m.)SS400 (Size 6 m.)', 'kg.')).toEqual({ factor: 299.4, unit: 'เส้น', note: '49.9 kg/m × 6 m' })
    expect(suggestConversion('เหล็กรางน้ำ C 100x50x5 (9.36 kg/m) ยาว 12 m', 'กก.')?.factor).toBe(112.32)
  })

  it('ไม่เดาเมื่อ BOQ ไม่ได้คิดเป็นกิโล หรือรายการไม่บอกน้ำหนักและความยาว', () => {
    expect(suggestConversion('เหล็ก H-BEAM (49.9 kg/m) Size 6 m.', 'เส้น')).toBeNull()
    expect(suggestConversion('สีรองพื้นกันสนิม', 'kg')).toBeNull()
    expect(suggestConversion('เหล็กแผ่น 4x8 ฟุต หนา 6 mm', 'kg')).toBeNull()
  })

  it('แปลงเป็นหน่วย BOQ แล้วยอดเงินเท่าเดิม', () => {
    const r = toBoqUnits(10, 9185.59, 299.4)
    expect(r.qty).toBeCloseTo(2994, 6)
    expect(r.unitPrice).toBeCloseTo(30.68, 2)
    expect(r.unitPrice).toBe(30.68)
    expect(r.qty * r.unitPrice).toBeCloseTo(10 * 9185.59, 0)
  })
})
