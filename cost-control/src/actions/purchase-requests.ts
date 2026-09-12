'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { notify, approverIdsFor } from '@/lib/notifications'
import { formatBaht } from '@/lib/format'
import { fail, type ActionResult } from './types'

export interface PrLinePayload {
  boq_item_id: string
  description: string
  qty: number
  unit: string | null
  unit_price: number
  supplier_name: string | null
  supplier_id: string | null
  variance_reason: string | null
}

export interface QueuedPrPayload {
  client_ref: string
  project_id: string
  needed_by_date: string | null
  note: string | null
  lines: PrLinePayload[]
}

// สร้าง PR + รายการ แล้วส่งอนุมัติทันที (routing คำนวณที่ DB) idempotent ด้วย client_ref
export async function submitPurchaseRequest(payload: QueuedPrPayload): Promise<ActionResult<{ id: string; pr_no: string; status: string }>> {
  const user = await requireUser()
  const supabase = await createClient()

  if (!payload.project_id) return fail('กรุณาเลือกโครงการ')
  if (!payload.lines?.length) return fail('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ')
  for (const l of payload.lines) {
    if (!l.boq_item_id) return fail('กรุณาเลือกรายการ BOQ')
    if (!(l.qty > 0)) return fail('ปริมาณต้องมากกว่า 0')
    if (!(l.unit_price >= 0)) return fail('ราคาต่อหน่วยไม่ถูกต้อง')
  }

  // กันส่งซ้ำจาก offline queue
  if (payload.client_ref) {
    const { data: existing } = await supabase
      .from('purchase_requests')
      .select('id, pr_no, status')
      .eq('client_ref', payload.client_ref)
      .maybeSingle()
    if (existing) return { ok: true, data: existing }
  }

  const { data: prNo, error: noErr } = await supabase.rpc('next_document_no', { p_type: 'PR' })
  if (noErr) return fail(noErr)

  const { data: pr, error: prErr } = await supabase
    .from('purchase_requests')
    .insert({
      pr_no: prNo as string,
      project_id: payload.project_id,
      requested_by: user.id,
      status: 'draft',
      needed_by_date: payload.needed_by_date || null,
      note: payload.note || null,
      client_ref: payload.client_ref || null,
      created_by: user.id,
    })
    .select('id, pr_no')
    .single()
  if (prErr) return fail(prErr)

  const { error: itemErr } = await supabase.from('purchase_request_items').insert(
    payload.lines.map(l => ({
      pr_id: pr.id,
      boq_item_id: l.boq_item_id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
      supplier_name: l.supplier_name,
      supplier_id: l.supplier_id,
      variance_reason: l.variance_reason,
      created_by: user.id,
    }))
  )
  if (itemErr) {
    await supabase.from('purchase_requests').delete().eq('id', pr.id)
    return fail(itemErr)
  }

  const { data: status, error: subErr } = await supabase.rpc('submit_purchase_request', { p_pr_id: pr.id })
  if (subErr) {
    await supabase.from('purchase_requests').delete().eq('id', pr.id)
    return fail(subErr)
  }

  const { data: full } = await supabase.from('purchase_requests').select('total_amount, projects(name)').eq('id', pr.id).single()
  const projectName = (full?.projects as unknown as { name: string } | null)?.name ?? ''
  await notify({
    event: 'pr_pending',
    userIds: await approverIdsFor(payload.project_id, 'pending_pm'),
    title: `ใบขอซื้อ ${pr.pr_no} รออนุมัติ`,
    body: `${projectName} มูลค่า ${formatBaht(full?.total_amount)} บาท โดย ${user.profile.full_name}`,
    link: `/pr/${pr.id}`,
  })

  revalidatePath('/pr')
  revalidatePath('/approvals')
  return { ok: true, data: { id: pr.id, pr_no: pr.pr_no, status: String(status) } }
}

// ใช้จาก offline queue
export async function submitQueuedPurchaseRequest(payload: QueuedPrPayload): Promise<{ ok: boolean; error?: string }> {
  const res = await submitPurchaseRequest(payload)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

export async function decidePurchaseRequest(prId: string, decision: 'approved' | 'rejected', comment: string): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: status, error } = await supabase.rpc('decide_purchase_request', {
    p_pr_id: prId,
    p_decision: decision,
    p_comment: comment || null,
  })
  if (error) return fail(error)

  const { data: pr } = await supabase
    .from('purchase_requests')
    .select('pr_no, project_id, requested_by, total_amount, projects(name)')
    .eq('id', prId)
    .single()
  if (pr) {
    const projectName = (pr.projects as unknown as { name: string } | null)?.name ?? ''
    if (status === 'pending_management') {
      await notify({
        event: 'pr_pending',
        userIds: await approverIdsFor(pr.project_id, 'pending_management'),
        title: `ใบขอซื้อ ${pr.pr_no} รอฝ่ายบริหารอนุมัติ`,
        body: `${projectName} มูลค่า ${formatBaht(pr.total_amount)} บาท ผ่านขั้นผู้จัดการโครงการแล้ว`,
        link: `/pr/${prId}`,
      })
    } else {
      await notify({
        event: 'pr_decided',
        userIds: [pr.requested_by],
        title: status === 'approved' ? `ใบขอซื้อ ${pr.pr_no} ได้รับอนุมัติ` : `ใบขอซื้อ ${pr.pr_no} ไม่ได้รับอนุมัติ`,
        body: status === 'approved' ? `โดย ${user.profile.full_name}` : `เหตุผล: ${comment}`,
        link: `/pr/${prId}`,
      })
    }
  }

  revalidatePath('/pr')
  revalidatePath(`/pr/${prId}`)
  revalidatePath('/approvals')
  return { ok: true, data: { status: String(status) } }
}

export async function cancelPurchaseRequest(prId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase
    .from('purchase_requests')
    .update({ status: 'cancelled' })
    .eq('id', prId)
    .in('status', ['draft', 'pending_pm', 'pending_management', 'rejected'])
  if (error) return fail(error)
  revalidatePath('/pr')
  revalidatePath(`/pr/${prId}`)
  return { ok: true, data: undefined }
}
