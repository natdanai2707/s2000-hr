import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { documentKey, findDuplicatePurchases } from '@/lib/purchase/duplicates'

describe('เลขที่เอกสารสำหรับหาใบซ้ำ', () => {
  it('ตัดช่องว่างและเครื่องหมาย ตัวพิมพ์เล็ก', () => {
    expect(documentKey('PO-6611-0412')).toBe('po66110412')
    expect(documentKey(' po 6611/0412 ')).toBe('po66110412')
    expect(documentKey('บิล 0087')).toBe('บิล0087')
  })
  it('สั้นหรือว่างไม่ใช้เทียบ', () => {
    expect(documentKey('12')).toBeNull()
    expect(documentKey(null)).toBeNull()
  })
})

// client ปลอม: คืนแถวตามว่าค้นด้วยเลขที่เอกสารหรือด้วยยอดเงิน
function fakeDb(byDoc: unknown[], byTotal: unknown[]): SupabaseClient {
  return {
    from: () => {
      let doc = false
      const q = {
        select: () => q,
        eq: (col: string) => { if (col === 'document_key') doc = true; return q },
        neq: () => q, gte: () => q, lte: () => q,
        limit: () => Promise.resolve({ data: doc ? byDoc : byTotal }),
      }
      return q
    },
  } as unknown as SupabaseClient
}

const row = (id: string, supplier: string | null, extra: object = {}) => ({
  id, pr_no: `PR-${id}`, document_no: null, total_amount: 89000, created_at: '2026-11-20T00:00:00Z',
  projects: { code: 'A6910-04' }, purchase_request_items: [{ supplier_name: supplier }], ...extra,
})

describe('หาใบที่อาจบันทึกซ้ำ', () => {
  it('เลขที่เอกสารตรงกัน นับว่าซ้ำเสมอ', async () => {
    const r = await findDuplicatePurchases(fakeDb([row('1', 'ร้านอื่น', { document_no: 'PO-1' })], []), { project_id: 'p', document_no: 'PO 1x', total: 1, supplier_name: 'ร้าน ก' })
    expect(r.map(d => [d.pr_no, d.reason])).toEqual([['PR-1', 'document_no']])
  })
  it('ยอดเท่ากันในโครงการเดียวกัน ซ้ำเมื่อผู้ขายตรงกันหรือไม่ระบุ', async () => {
    const r = await findDuplicatePurchases(
      fakeDb([], [row('2', 'น.ส. ชนิษฐา สุนทรากร'), row('3', 'ร้านเหล็กใต้'), row('4', null)]),
      { project_id: 'p', document_no: null, total: 89000, supplier_name: 'น.ส. ชนิษฐา  สุนทรากร' }
    )
    expect(r.map(d => d.pr_no)).toEqual(['PR-2', 'PR-4'])
  })
})
