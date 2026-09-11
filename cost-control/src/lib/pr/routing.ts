// กติกา routing ใบขอซื้อ (ฝั่ง TS ใช้แสดงผลทันทีในฟอร์ม ฝั่ง DB ตรวจซ้ำใน submit_purchase_request)
import type { Settings } from '@/lib/types'

export interface PrLineInput {
  qty: number
  unitPrice: number
  boqQty: number
  boqUnitCost: number
  qtyOrdered: number
  isOffBoq: boolean
  varianceReason?: string | null
}

export interface LineEvaluation {
  qtyRemaining: number
  qtyOverBy: number
  qtyOverBoq: boolean
  priceDiff: number
  priceDiffPct: number | null
  priceOverThreshold: boolean
  priceBelow: boolean
  requiresReason: boolean
  amount: number
}

export function evaluateLine(line: PrLineInput, settings: Settings): LineEvaluation {
  const qtyRemaining = line.boqQty - line.qtyOrdered
  const qtyOverBy = line.isOffBoq ? 0 : Math.max(line.qtyOrdered + line.qty - line.boqQty, 0)
  const qtyOverBoq = qtyOverBy > 0
  const priceDiff = line.unitPrice - line.boqUnitCost
  const priceDiffPct = line.boqUnitCost > 0 ? (priceDiff / line.boqUnitCost) * 100 : null
  const priceOverThreshold =
    !line.isOffBoq &&
    line.boqQty > 0 &&
    line.unitPrice > line.boqUnitCost * (1 + settings.price_variance_threshold_pct / 100)
  const priceBelow = !line.isOffBoq && line.boqUnitCost > 0 && line.unitPrice < line.boqUnitCost
  return {
    qtyRemaining,
    qtyOverBy,
    qtyOverBoq,
    priceDiff,
    priceDiffPct,
    priceOverThreshold,
    priceBelow,
    requiresReason: qtyOverBoq || priceOverThreshold || line.isOffBoq,
    amount: line.qty * line.unitPrice,
  }
}

export type PrRoute = 'pm_only' | 'pm_then_management'

export interface RoutingResult {
  total: number
  requiresManagement: boolean
  route: PrRoute
  firstStatus: 'pending_pm'
  missingReason: boolean
}

// มูลค่า PR <= pm_approval_limit และไม่เกิน BOQ -> PM อย่างเดียว
// นอกนั้น -> PM แล้วต่อด้วย management
export function routePurchaseRequest(lines: PrLineInput[], settings: Settings): RoutingResult {
  let total = 0
  let anyOver = false
  let missingReason = false
  for (const line of lines) {
    const ev = evaluateLine(line, settings)
    total += ev.amount
    if (ev.qtyOverBoq || line.isOffBoq) anyOver = true
    if (ev.requiresReason && !(line.varianceReason ?? '').trim()) missingReason = true
  }
  const requiresManagement =
    total > settings.pm_approval_limit || (settings.qty_over_boq_requires_management && anyOver)
  return {
    total,
    requiresManagement,
    route: requiresManagement ? 'pm_then_management' : 'pm_only',
    firstStatus: 'pending_pm',
    missingReason,
  }
}

// สถานะถัดไปหลังการตัดสินใจแต่ละขั้น
export function nextStatusAfterDecision(
  current: 'pending_pm' | 'pending_management',
  decision: 'approved' | 'rejected',
  requiresManagement: boolean,
  deciderIsManagement: boolean
): 'approved' | 'rejected' | 'pending_management' {
  if (decision === 'rejected') return 'rejected'
  if (current === 'pending_pm' && requiresManagement && !deciderIsManagement) return 'pending_management'
  return 'approved'
}
