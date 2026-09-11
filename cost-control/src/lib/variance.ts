// แยกส่วนต่างต้นทุนเป็น 3 สาเหตุ (ใช้ตอนปิดโครงการ เฟส 3 แต่ logic บริสุทธิ์ทดสอบได้ตั้งแต่ตอนนี้)
// quantity variance = (qty จริง − qty BOQ) × unit_cost BOQ
// price variance    = (unit_cost จริงเฉลี่ย − unit_cost BOQ) × qty จริง
// off-BOQ           = actual ของรายการ is_off_boq

export interface VarianceInput {
  boqQty: number
  boqUnitCost: number
  actualQty: number
  actualAmount: number
  isOffBoq: boolean
}

export interface VarianceResult {
  quantityVariance: number
  priceVariance: number
  offBoq: number
  total: number
}

export function decomposeVariance(input: VarianceInput): VarianceResult {
  if (input.isOffBoq) {
    return { quantityVariance: 0, priceVariance: 0, offBoq: input.actualAmount, total: input.actualAmount }
  }
  const actualUnitCost = input.actualQty > 0 ? input.actualAmount / input.actualQty : input.boqUnitCost
  const quantityVariance = (input.actualQty - input.boqQty) * input.boqUnitCost
  const priceVariance = (actualUnitCost - input.boqUnitCost) * input.actualQty
  return {
    quantityVariance,
    priceVariance,
    offBoq: 0,
    total: quantityVariance + priceVariance,
  }
}

export function sumVariances(items: VarianceResult[]): VarianceResult {
  return items.reduce(
    (acc, v) => ({
      quantityVariance: acc.quantityVariance + v.quantityVariance,
      priceVariance: acc.priceVariance + v.priceVariance,
      offBoq: acc.offBoq + v.offBoq,
      total: acc.total + v.total,
    }),
    { quantityVariance: 0, priceVariance: 0, offBoq: 0, total: 0 }
  )
}
