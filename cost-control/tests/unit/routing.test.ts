import { describe, it, expect } from 'vitest'
import { evaluateLine, routePurchaseRequest, nextStatusAfterDecision } from '@/lib/pr/routing'
import { DEFAULT_SETTINGS } from '@/lib/types'

const settings = { ...DEFAULT_SETTINGS, price_variance_threshold_pct: 5, pm_approval_limit: 50000 }

describe('evaluateLine: เปรียบเทียบกับ BOQ', () => {
  it('คำนวณคงเหลือและไม่เกิน BOQ เมื่อสั่งภายในปริมาณ', () => {
    const ev = evaluateLine({ qty: 10, unitPrice: 100, boqQty: 100, boqUnitCost: 100, qtyOrdered: 50, isOffBoq: false }, settings)
    expect(ev.qtyRemaining).toBe(50)
    expect(ev.qtyOverBoq).toBe(false)
    expect(ev.priceOverThreshold).toBe(false)
    expect(ev.requiresReason).toBe(false)
    expect(ev.amount).toBe(1000)
  })

  it('แจ้งเกิน BOQ x หน่วย เมื่อ สั่งแล้ว + ครั้งนี้ > ปริมาณ BOQ', () => {
    const ev = evaluateLine({ qty: 60, unitPrice: 100, boqQty: 100, boqUnitCost: 100, qtyOrdered: 50, isOffBoq: false }, settings)
    expect(ev.qtyOverBoq).toBe(true)
    expect(ev.qtyOverBy).toBe(10)
    expect(ev.requiresReason).toBe(true)
  })

  it('เกิน threshold ราคาเมื่อแพงกว่าราคาทดเกิน 5%', () => {
    const ok = evaluateLine({ qty: 1, unitPrice: 105, boqQty: 10, boqUnitCost: 100, qtyOrdered: 0, isOffBoq: false }, settings)
    expect(ok.priceOverThreshold).toBe(false)
    const over = evaluateLine({ qty: 1, unitPrice: 105.01, boqQty: 10, boqUnitCost: 100, qtyOrdered: 0, isOffBoq: false }, settings)
    expect(over.priceOverThreshold).toBe(true)
    expect(over.priceDiffPct).toBeCloseTo(5.01, 2)
    expect(over.requiresReason).toBe(true)
  })

  it('ถูกกว่าราคาทดแสดง priceBelow', () => {
    const ev = evaluateLine({ qty: 1, unitPrice: 90, boqQty: 10, boqUnitCost: 100, qtyOrdered: 0, isOffBoq: false }, settings)
    expect(ev.priceBelow).toBe(true)
    expect(ev.priceDiff).toBe(-10)
  })

  it('รายการนอก BOQ ต้องระบุเหตุผลเสมอ และไม่เช็คปริมาณ/ราคา', () => {
    const ev = evaluateLine({ qty: 5, unitPrice: 999, boqQty: 0, boqUnitCost: 0, qtyOrdered: 0, isOffBoq: true }, settings)
    expect(ev.qtyOverBoq).toBe(false)
    expect(ev.priceOverThreshold).toBe(false)
    expect(ev.requiresReason).toBe(true)
  })
})

describe('routePurchaseRequest: approval routing', () => {
  const inBoq = { boqQty: 100, boqUnitCost: 100, qtyOrdered: 0, isOffBoq: false }

  it('มูลค่า <= pm_approval_limit และไม่เกิน BOQ -> PM อย่างเดียว', () => {
    const r = routePurchaseRequest([{ ...inBoq, qty: 100, unitPrice: 500 }], settings)
    expect(r.total).toBe(50000)
    expect(r.requiresManagement).toBe(false)
    expect(r.route).toBe('pm_only')
    expect(r.firstStatus).toBe('pending_pm')
  })

  it('มูลค่าเกินวงเงิน -> PM แล้วต่อด้วย management', () => {
    const r = routePurchaseRequest([{ ...inBoq, qty: 100, unitPrice: 500.01 }], settings)
    expect(r.requiresManagement).toBe(true)
    expect(r.route).toBe('pm_then_management')
  })

  it('เกิน BOQ แม้มูลค่าน้อย -> ต้องผ่าน management (ตาม setting)', () => {
    const r = routePurchaseRequest([{ ...inBoq, qty: 101, unitPrice: 1, varianceReason: 'แบบเปลี่ยน' }], settings)
    expect(r.requiresManagement).toBe(true)
    expect(r.missingReason).toBe(false)
  })

  it('เกิน BOQ แต่ setting ปิด -> PM อย่างเดียวถ้าไม่เกินวงเงิน', () => {
    const r = routePurchaseRequest([{ ...inBoq, qty: 101, unitPrice: 1, varianceReason: 'x' }], { ...settings, qty_over_boq_requires_management: false })
    expect(r.requiresManagement).toBe(false)
  })

  it('PR หลายรายการ ใช้รายการที่แย่ที่สุด และรวมมูลค่าทุกรายการ', () => {
    const r = routePurchaseRequest(
      [
        { ...inBoq, qty: 10, unitPrice: 100 },
        { ...inBoq, qty: 10, unitPrice: 200, boqUnitCost: 100 },
      ],
      settings
    )
    expect(r.total).toBe(3000)
    expect(r.requiresManagement).toBe(false)
    expect(r.missingReason).toBe(true) // รายการที่ 2 แพงเกิน threshold ไม่มีเหตุผล
  })

  it('บอกว่าขาดเหตุผลเมื่อเกิน threshold แต่ไม่ได้กรอก', () => {
    const r = routePurchaseRequest([{ ...inBoq, qty: 1, unitPrice: 200 }], settings)
    expect(r.missingReason).toBe(true)
    const ok = routePurchaseRequest([{ ...inBoq, qty: 1, unitPrice: 200, varianceReason: 'ราคาตลาดขึ้น' }], settings)
    expect(ok.missingReason).toBe(false)
  })
})

describe('nextStatusAfterDecision', () => {
  it('PM อนุมัติ PR ที่ต้องผ่าน management -> pending_management', () => {
    expect(nextStatusAfterDecision('pending_pm', 'approved', true, false)).toBe('pending_management')
  })
  it('PM อนุมัติ PR ปกติ -> approved', () => {
    expect(nextStatusAfterDecision('pending_pm', 'approved', false, false)).toBe('approved')
  })
  it('management อนุมัติที่ขั้น PM ได้เลย -> approved', () => {
    expect(nextStatusAfterDecision('pending_pm', 'approved', true, true)).toBe('approved')
  })
  it('ปฏิเสธขั้นใดก็ตาม -> rejected', () => {
    expect(nextStatusAfterDecision('pending_pm', 'rejected', true, false)).toBe('rejected')
    expect(nextStatusAfterDecision('pending_management', 'rejected', true, true)).toBe('rejected')
  })
  it('management อนุมัติขั้นสุดท้าย -> approved', () => {
    expect(nextStatusAfterDecision('pending_management', 'approved', true, true)).toBe('approved')
  })
})
