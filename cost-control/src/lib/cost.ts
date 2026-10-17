import type { ProjectSummary } from '@/lib/types'
import { toNumber } from '@/lib/format'

export type CostTone = 'normal' | 'watch' | 'alert'

// ต้นทุนที่ใช้ไปแล้ว = ต้นทุนจริง (รับของ ค่าใช้จ่าย งวดผู้รับเหมา) + ยอดผูกพัน (สั่งแล้วยังไม่รับ)
// ยอดผูกพันคือเงินที่สัญญาจะจ่ายแล้ว นับรวมเพื่อเตือนก่อนเกินงบ ในโหมดบันทึกซื้อตรงยอดผูกพันเป็นศูนย์
export function consumedAmount(p: Pick<ProjectSummary, 'actual' | 'committed'>): number {
  return toNumber(p.actual) + toNumber(p.committed)
}

export function consumedPct(p: Pick<ProjectSummary, 'actual' | 'committed' | 'total_budget'>): number | null {
  const budget = toNumber(p.total_budget)
  if (budget <= 0) return null
  return (consumedAmount(p) / budget) * 100
}

// สถานะสี: เฟส 1 ยังไม่มีความก้าวหน้า ใช้ต้นทุนที่ใช้ไปเทียบงบ เกินงบหรือกำไรพยากรณ์ติดลบ = เตือน, เกิน 95% = เฝ้าระวัง
// เมื่อมีความก้าวหน้า (เฟส 2) ใช้ส่วนต่าง ต้นทุน% − ความก้าวหน้า% แทน: <= 0 ปกติ, 0 ถึง 5 เฝ้าระวัง, > 5 เตือน
export function costTone(p: ProjectSummary): CostTone {
  if (p.cost_vs_progress !== null && p.cost_vs_progress !== undefined) {
    const d = toNumber(p.cost_vs_progress)
    if (d <= 0) return 'normal'
    if (d <= 5) return 'watch'
    return 'alert'
  }
  const pct = consumedPct(p) ?? 0
  if (pct > 100 || toNumber(p.forecast_profit) < 0) return 'alert'
  if (pct > 95) return 'watch'
  return 'normal'
}

export const COST_TONE_LABELS: Record<CostTone, string> = {
  normal: 'ปกติ',
  watch: 'เฝ้าระวัง',
  alert: 'เตือน',
}

// โครงการที่ยังไม่มี BOQ ยืนยัน ไม่มีงบให้เทียบ กำไรพยากรณ์จะเท่ากับมูลค่าสัญญาเต็ม ซึ่งไม่มีความหมาย
export function hasBudget(p: Pick<ProjectSummary, 'confirmed_version_id' | 'total_budget'>): boolean {
  return !!p.confirmed_version_id && toNumber(p.total_budget) > 0
}

export interface PortfolioTotals {
  count: number
  contract: number
  budget: number
  consumed: number
  expectedProfit: number
  forecastProfit: number
  consumedPct: number | null
}

// รวมเฉพาะโครงการที่มีงบแล้ว
export function portfolioTotals(projects: ProjectSummary[]): PortfolioTotals {
  const budgeted = projects.filter(hasBudget)
  const t = budgeted.reduce(
    (acc, p) => ({
      contract: acc.contract + toNumber(p.contract_value),
      budget: acc.budget + toNumber(p.total_budget),
      consumed: acc.consumed + consumedAmount(p),
      expectedProfit: acc.expectedProfit + toNumber(p.expected_profit),
      forecastProfit: acc.forecastProfit + toNumber(p.forecast_profit),
    }),
    { contract: 0, budget: 0, consumed: 0, expectedProfit: 0, forecastProfit: 0 }
  )
  return { ...t, count: budgeted.length, consumedPct: t.budget > 0 ? (t.consumed / t.budget) * 100 : null }
}
