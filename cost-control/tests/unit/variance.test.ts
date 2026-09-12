import { describe, it, expect } from 'vitest'
import { decomposeVariance, sumVariances } from '@/lib/variance'

describe('decomposeVariance: แยกส่วนต่างต้นทุน 3 สาเหตุ', () => {
  it('quantity variance = (qty จริง − qty BOQ) × unit_cost BOQ', () => {
    const v = decomposeVariance({ boqQty: 100, boqUnitCost: 50, actualQty: 110, actualAmount: 110 * 50, isOffBoq: false })
    expect(v.quantityVariance).toBe(500)
    expect(v.priceVariance).toBe(0)
    expect(v.offBoq).toBe(0)
    expect(v.total).toBe(500)
  })

  it('price variance = (unit_cost จริงเฉลี่ย − unit_cost BOQ) × qty จริง', () => {
    const v = decomposeVariance({ boqQty: 100, boqUnitCost: 50, actualQty: 100, actualAmount: 5500, isOffBoq: false })
    expect(v.quantityVariance).toBe(0)
    expect(v.priceVariance).toBeCloseTo(500, 6)
    expect(v.total).toBeCloseTo(500, 6)
  })

  it('ทั้งปริมาณและราคาเปลี่ยน ส่วนต่างรวม = actual − budget', () => {
    const v = decomposeVariance({ boqQty: 100, boqUnitCost: 50, actualQty: 120, actualAmount: 120 * 55, isOffBoq: false })
    expect(v.quantityVariance).toBe(1000) // 20 × 50
    expect(v.priceVariance).toBeCloseTo(600, 6) // 5 × 120
    expect(v.total).toBeCloseTo(120 * 55 - 100 * 50, 6)
  })

  it('รายการ is_off_boq นับเป็น off-BOQ ทั้งหมด', () => {
    const v = decomposeVariance({ boqQty: 0, boqUnitCost: 0, actualQty: 3, actualAmount: 9000, isOffBoq: true })
    expect(v).toEqual({ quantityVariance: 0, priceVariance: 0, offBoq: 9000, total: 9000 })
  })

  it('ยังไม่ใช้เลย (actualQty 0) ส่วนต่างปริมาณเป็นลบเต็มงบ', () => {
    const v = decomposeVariance({ boqQty: 10, boqUnitCost: 100, actualQty: 0, actualAmount: 0, isOffBoq: false })
    expect(v.quantityVariance).toBe(-1000)
    expect(v.priceVariance).toBe(0)
  })

  it('sumVariances รวมต่อหมวด', () => {
    const s = sumVariances([
      { quantityVariance: 100, priceVariance: 20, offBoq: 0, total: 120 },
      { quantityVariance: -50, priceVariance: 0, offBoq: 300, total: 250 },
    ])
    expect(s).toEqual({ quantityVariance: 50, priceVariance: 20, offBoq: 300, total: 370 })
  })
})
