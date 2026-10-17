import { describe, it, expect } from 'vitest'
import { consumedAmount, consumedPct, costTone, hasBudget, portfolioTotals } from '@/lib/cost'
import { visibleFor, SIDEBAR_ITEMS, BOTTOM_ITEMS } from '@/components/app/nav-config'
import { usesDirectPurchase, DEFAULT_SETTINGS, type ProjectSummary } from '@/lib/types'

const base: ProjectSummary = {
  project_id: 'x', code: 'X', name: 'X', customer_name: null, branch_id: 'b', status: 'active',
  contract_value: 0, start_date: null, planned_end_date: null, actual_end_date: null, confirmed_version_id: 'v',
  total_budget: 0, expected_profit: 0, committed: 0, actual: 0, paid: 0, cost_pct: null, progress_pct: null,
  cost_vs_progress: null, forecast_profit: 0, days_remaining: null,
}
const p = (o: Partial<ProjectSummary>): ProjectSummary => ({ ...base, ...o })

describe('ต้นทุนที่ใช้ไปเทียบงบ', () => {
  it('ใช้ไปแล้ว = ต้นทุนจริง + ยอดผูกพัน', () => {
    expect(consumedAmount(p({ actual: 700, committed: 300 }))).toBe(1000)
    expect(consumedPct(p({ actual: 700, committed: 300, total_budget: 2000 }))).toBe(50)
  })

  it('ยังไม่มีงบ คืนค่าว่าง ไม่หารศูนย์', () => {
    expect(consumedPct(p({ actual: 100, total_budget: 0 }))).toBeNull()
  })

  it('สถานะ: เกินงบหรือกำไรพยากรณ์ติดลบ = เตือน, เกิน 95% = เฝ้าระวัง', () => {
    expect(costTone(p({ actual: 1030, total_budget: 1000, forecast_profit: 10 }))).toBe('alert')
    expect(costTone(p({ actual: 500, total_budget: 1000, forecast_profit: -1 }))).toBe('alert')
    expect(costTone(p({ actual: 960, total_budget: 1000, forecast_profit: 10 }))).toBe('watch')
    expect(costTone(p({ actual: 400, total_budget: 1000, forecast_profit: 10 }))).toBe('normal')
  })

  it('ยอดรวมนับเฉพาะโครงการที่ยืนยัน BOQ แล้ว', () => {
    const t = portfolioTotals([
      p({ contract_value: 1000, total_budget: 800, actual: 400, expected_profit: 200, forecast_profit: 600 }),
      p({ contract_value: 500, total_budget: 0, confirmed_version_id: null, forecast_profit: 500 }),
    ])
    expect(t).toMatchObject({ count: 1, contract: 1000, budget: 800, consumed: 400, forecastProfit: 600, consumedPct: 50 })
    expect(hasBudget(p({ confirmed_version_id: null, total_budget: 100 }))).toBe(false)
  })
})

describe('โหมดบันทึกซื้อตรง', () => {
  const on = { ...DEFAULT_SETTINGS, direct_purchase_mode: true }

  it('ใช้ได้เฉพาะฝ่ายบริหารและผู้ดูแลระบบ', () => {
    expect(usesDirectPurchase(on, 'management')).toBe(true)
    expect(usesDirectPurchase(on, 'admin')).toBe(true)
    expect(usesDirectPurchase(on, 'engineer')).toBe(false)
    expect(usesDirectPurchase(DEFAULT_SETTINGS, 'management')).toBe(false)
  })

  it('เมนูใบสั่งซื้อและรับของยังแสดง แต่ถูกทำเครื่องหมายปิดชั่วคราว', () => {
    const items = visibleFor(SIDEBAR_ITEMS, 'management', true)
    expect(items.find(i => i.href === '/po')?.pausedInDirectMode).toBe(true)
    expect(items.find(i => i.href === '/receiving')?.pausedInDirectMode).toBe(true)
    expect(items.find(i => i.href === '/pr')?.label).toBe('รายการสั่งซื้อ')
  })

  it('แถบล่างบนมือถือไม่มีรออนุมัติ และมีครบ 4 ช่อง', () => {
    const direct = visibleFor(BOTTOM_ITEMS, 'management', true)
    expect(direct.map(i => i.label)).toEqual(['ภาพรวม', 'บันทึกซื้อ', 'รายการซื้อ', 'โครงการ'])
    expect(visibleFor(BOTTOM_ITEMS, 'engineer', false).map(i => i.href)).toEqual(['/', '/pr/new', '/progress', '/approvals'])
  })
})
