import type { SupabaseClient } from '@supabase/supabase-js'

// กันบันทึกการสั่งซื้อซ้ำ: เลขที่เอกสารเดียวกัน หรือโครงการ ผู้ขาย และยอดเดียวกันภายใน 90 วัน

export interface DuplicatePurchase {
  id: string
  pr_no: string
  project_code: string
  supplier_name: string | null
  document_no: string | null
  total_amount: number
  created_at: string
  reason: 'document_no' | 'same_total'
}

// ตัดช่องว่างและเครื่องหมาย เหลือตัวอักษรกับตัวเลข ตัวพิมพ์เล็ก
export function documentKey(no: string | null | undefined): string | null {
  const k = (no ?? '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
  return k.length >= 3 ? k : null
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/^(บริษัท|บจก\.?|หจก\.?)/, '')

type Row = {
  id: string
  pr_no: string
  document_no: string | null
  total_amount: number | string
  created_at: string
  projects: { code: string } | null
  purchase_request_items: { supplier_name: string | null }[] | null
}

// ใช้ client ที่เห็นทุกโครงการ (service role) เพราะใบซ้ำอาจถูกบันทึกไว้คนละโครงการที่ผู้ใช้มองไม่เห็น
export async function findDuplicatePurchases(
  db: SupabaseClient,
  input: { project_id: string; document_no: string | null; total: number; supplier_name: string | null }
): Promise<DuplicatePurchase[]> {
  const select = 'id, pr_no, document_no, total_amount, created_at, projects(code), purchase_request_items(supplier_name)'
  const key = documentKey(input.document_no)
  const since = new Date(Date.now() - 90 * 86400000).toISOString()
  const [byDoc, byTotal] = await Promise.all([
    key
      ? db.from('purchase_requests').select(select).eq('document_key', key).neq('status', 'cancelled').limit(5)
      : Promise.resolve({ data: [] as Row[] }),
    input.total > 0
      ? db
          .from('purchase_requests')
          .select(select)
          .eq('project_id', input.project_id)
          .neq('status', 'cancelled')
          .gte('created_at', since)
          .gte('total_amount', input.total - 0.5)
          .lte('total_amount', input.total + 0.5)
          .limit(10)
      : Promise.resolve({ data: [] as Row[] }),
  ])
  const out = new Map<string, DuplicatePurchase>()
  const toDup = (r: Row, reason: DuplicatePurchase['reason']): DuplicatePurchase => ({
    id: r.id,
    pr_no: r.pr_no,
    project_code: r.projects?.code ?? '',
    supplier_name: r.purchase_request_items?.find(i => i.supplier_name)?.supplier_name ?? null,
    document_no: r.document_no,
    total_amount: Number(r.total_amount),
    created_at: r.created_at,
    reason,
  })
  for (const r of (byDoc.data ?? []) as unknown as Row[]) out.set(r.id, toDup(r, 'document_no'))
  const sup = norm(input.supplier_name)
  for (const r of (byTotal.data ?? []) as unknown as Row[]) {
    if (out.has(r.id)) continue
    const d = toDup(r, 'same_total')
    // ยอดเท่ากันในโครงการเดียวกัน นับว่าอาจซ้ำเมื่อผู้ขายเดียวกัน หรือฝั่งใดฝั่งหนึ่งไม่ได้ระบุผู้ขาย
    if (!sup || !d.supplier_name || norm(d.supplier_name) === sup) out.set(r.id, d)
  }
  return [...out.values()]
}
