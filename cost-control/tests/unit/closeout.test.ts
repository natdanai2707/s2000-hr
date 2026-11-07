import { describe, it, expect } from 'vitest'
import { closeoutWarnings } from '@/lib/closeout'

const base = { contract_value: 100000, billed_excl_vat: 0, outstanding: 0, cash_received: 0, retention_held: 0, handover_date: null }
const keys = (f: Parameters<typeof closeoutWarnings>[0]) => closeoutWarnings(f).map(w => w.key)

describe('ป้ายเตือนงานที่เสร็จแล้ว', () => {
  it('ยังไม่ส่งงาน ยังไม่วางบิล', () => {
    expect(keys(base)).toEqual(['handover', 'no_billing'])
  })
  it('วางบิลบางส่วน ยังไม่รับเงิน', () => {
    expect(keys({ ...base, handover_date: '2026-11-01', billed_excl_vat: 40000, outstanding: 42800 })).toEqual(['billing_partial', 'no_receipt'])
    expect(closeoutWarnings({ ...base, billed_excl_vat: 40000 })[1].label).toContain('40%')
  })
  it('วางบิลครบ รับเงินบางส่วน เงินประกันยังถือไว้', () => {
    expect(keys({ ...base, handover_date: '2026-11-01', billed_excl_vat: 100000, cash_received: 50000, outstanding: 52000, retention_held: 5000 })).toEqual([
      'outstanding',
      'retention',
    ])
  })
  it('ครบทุกเรื่อง ไม่มีป้ายเตือน', () => {
    expect(keys({ ...base, handover_date: '2026-11-01', billed_excl_vat: 100000, cash_received: 107000 })).toEqual([])
  })
  it('ไม่มีข้อมูลรายรับเลย เตือนส่งงานและวางบิล', () => {
    expect(keys(null)).toEqual(['handover', 'no_billing'])
  })
})
