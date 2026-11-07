import { formatBaht, toNumber } from './format'
import type { ProjectStatus } from './types'

// งานที่แจ้งเสร็จแล้ว (closing) หรือปิดโครงการแล้ว (closed) ไม่อยู่ในกลุ่มกำลังดำเนินการ
export const FINISHED_STATUSES: ProjectStatus[] = ['closing', 'closed']
export const isFinished = (status: string) => status === 'closing' || status === 'closed'

export interface CloseoutFigures {
  contract_value: number | string | null
  billed_excl_vat: number | string | null
  outstanding: number | string | null
  cash_received: number | string | null
  retention_held: number | string | null
  handover_date: string | null
}

export interface CloseoutWarning {
  key: 'handover' | 'no_billing' | 'billing_partial' | 'no_receipt' | 'outstanding' | 'retention'
  label: string
  // ไปหน้าไหนเพื่อแก้
  target: 'handover' | 'billing'
}

const EPS = 0.005

// เรื่องที่ยังค้างของงานที่เสร็จแล้ว แจ้งงานเสร็จได้เสมอ ระบบแค่เตือนว่ายังขาดบันทึกอะไร
export function closeoutWarnings(f: CloseoutFigures | null | undefined): CloseoutWarning[] {
  const contract = toNumber(f?.contract_value)
  const billed = toNumber(f?.billed_excl_vat)
  const cash = toNumber(f?.cash_received)
  const outstanding = toNumber(f?.outstanding)
  const retention = toNumber(f?.retention_held)
  const out: CloseoutWarning[] = []
  if (!f?.handover_date) out.push({ key: 'handover', label: 'ยังไม่บันทึกการส่งงาน', target: 'handover' })
  if (billed <= EPS) out.push({ key: 'no_billing', label: 'ยังไม่มีบันทึกการวางบิล', target: 'billing' })
  else if (contract > 0 && billed < contract - EPS) {
    out.push({ key: 'billing_partial', label: `วางบิลแล้ว ${Math.floor((billed / contract) * 100)}% ยังขาด ${formatBaht(contract - billed)}`, target: 'billing' })
  }
  if (billed > EPS && cash <= EPS) out.push({ key: 'no_receipt', label: 'ยังไม่มีบันทึกการรับเงิน', target: 'billing' })
  else if (outstanding > EPS) out.push({ key: 'outstanding', label: `ค้างรับ ${formatBaht(outstanding)}`, target: 'billing' })
  if (retention > EPS) out.push({ key: 'retention', label: `เงินประกันผลงานรอคืน ${formatBaht(retention)}`, target: 'billing' })
  return out
}
