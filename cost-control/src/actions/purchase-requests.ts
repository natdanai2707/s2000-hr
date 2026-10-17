'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser, loadSettings } from '@/lib/auth'
import { usesDirectPurchase } from '@/lib/types'
import { notify, approverIdsFor } from '@/lib/notifications'
import { formatBaht } from '@/lib/format'
import { safeObjectName } from '@/lib/storage'
import { extractPurchaseDocument } from '@/lib/purchase/extract'
import { reviewExtraction, type ReviewedLine } from '@/lib/purchase/review'
import { fail, type ActionResult } from './types'

export interface PrLinePayload {
  boq_item_id: string
  description: string
  qty: number
  unit: string | null
  unit_price: number
  // หน่วย BOQ ต่อหนึ่งหน่วยที่ซื้อ ไม่ส่งมา (เช่นคิวออฟไลน์รุ่นเก่า) ถือว่าหน่วยเดียวกัน
  // null = ซื้อเป็นหน่วยอื่นแต่ยังไม่ระบุว่าเท่ากับกี่หน่วย BOQ
  qty_factor?: number | null
  supplier_name: string | null
  supplier_id: string | null
  variance_reason: string | null
}

export interface QueuedPrPayload {
  client_ref: string
  project_id: string
  needed_by_date: string | null
  note: string | null
  // รูปหรือ PDF ของเอกสารจัดซื้อที่แนบไว้ (อัปโหลดตอนให้ Claude อ่าน)
  attachment_path?: string | null
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
    if (l.qty_factor !== undefined && l.qty_factor !== null && !(l.qty_factor > 0)) return fail('ตัวแปลงหน่วยที่ซื้อต้องมากกว่า 0')
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
      // รับเฉพาะไฟล์ใต้โฟลเดอร์ของโครงการนี้
      attachment_path: payload.attachment_path?.startsWith(`projects/${payload.project_id}/purchases/`) ? payload.attachment_path : null,
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
      qty_factor: l.qty_factor === undefined ? 1 : l.qty_factor,
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

  // โหมดบันทึกซื้อตรง: อนุมัติ ออกใบสั่งซื้อ และรับของให้ในขั้นตอนเดียว ไม่ต้องแจ้งผู้อนุมัติ
  if (usesDirectPurchase(await loadSettings(), user.profile.role)) {
    const { error: directErr } = await supabase.rpc('record_direct_purchase', { p_pr_id: pr.id })
    if (directErr) {
      // RLS ลบได้เฉพาะใบร่าง ถอยสถานะกลับเป็นร่างก่อนลบ ไม่ให้เหลือใบค้างรออนุมัติ
      await supabase.from('purchase_requests').update({ status: 'draft' }).eq('id', pr.id)
      await supabase.from('purchase_requests').delete().eq('id', pr.id)
      return fail(directErr)
    }
    revalidatePath('/pr')
    revalidatePath('/')
    revalidatePath(`/projects/${payload.project_id}`)
    return { ok: true, data: { id: pr.id, pr_no: pr.pr_no, status: 'approved' } }
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

// ใบที่อนุมัติแล้วแต่ยังไม่ออกใบสั่งซื้อ (ค้างจากก่อนเปิดโหมดบันทึกซื้อตรง) บันทึกเป็นต้นทุนในขั้นตอนเดียว
export async function recordApprovedAsDirect(prId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { data: pr } = await supabase.from('purchase_requests').select('project_id').eq('id', prId).maybeSingle()
  const { error } = await supabase.rpc('record_direct_purchase', { p_pr_id: prId })
  if (error) return fail(error)
  revalidatePath('/pr')
  revalidatePath(`/pr/${prId}`)
  revalidatePath('/')
  if (pr) revalidatePath(`/projects/${pr.project_id}`)
  return { ok: true, data: undefined }
}

// ยกเลิกรายการที่บันทึกซื้อตรงผิด ต้นทุนจริงลดลงตาม ต้องระบุเหตุผล
export async function voidDirectPurchase(prId: string, reason: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { data: pr } = await supabase.from('purchase_requests').select('project_id').eq('id', prId).maybeSingle()
  const { error } = await supabase.rpc('void_direct_purchase', { p_pr_id: prId, p_reason: reason })
  if (error) return fail(error)
  revalidatePath('/pr')
  revalidatePath(`/pr/${prId}`)
  revalidatePath('/')
  if (pr) revalidatePath(`/projects/${pr.project_id}`)
  return { ok: true, data: undefined }
}

// เติมหรือแก้ตัวแปลงหน่วยของบรรทัดที่บันทึกไปแล้ว null = ยังไม่ทราบ ยอดเงินไม่เปลี่ยน ปริมาณเทียบ BOQ เปลี่ยนตาม
export async function setPurchaseQtyFactor(prItemId: string, factor: number | null): Promise<ActionResult> {
  await requireUser()
  if (factor !== null && !(factor > 0)) return fail('ตัวแปลงหน่วยต้องมากกว่า 0 หรือเว้นว่างไว้')
  const supabase = await createClient()
  const { data: item } = await supabase.from('purchase_request_items').select('pr_id, purchase_requests(project_id)').eq('id', prItemId).maybeSingle()
  const { error } = await supabase.rpc('set_purchase_qty_factor', { p_pr_item_id: prItemId, p_factor: factor })
  if (error) return fail(error)
  revalidatePath('/pr')
  revalidatePath('/')
  if (item) {
    revalidatePath(`/pr/${item.pr_id}`)
    const projectId = (item.purchase_requests as unknown as { project_id: string } | null)?.project_id
    if (projectId) revalidatePath(`/projects/${projectId}`)
  }
  return { ok: true, data: undefined }
}

export interface PurchaseDocumentResult {
  attachment_path: string
  // null เมื่ออ่านด้วย Claude ไม่ได้ ไฟล์ยังแนบไว้ได้ ผู้ใช้กรอกรายการเอง
  read_error: string | null
  supplier_name: string | null
  document_no: string | null
  document_date: string | null
  grand_total: number | null
  total_excl_vat: number | null
  lines: ReviewedLine[]
  issues: string[]
  notes: string[]
  warnings: string[]
}

const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const
type DocType = (typeof DOC_TYPES)[number]

// อัปโหลดรูปหรือ PDF ของเอกสารจัดซื้อ ให้ Claude อ่านรายการ แล้วตรวจตัวเลขด้วยโค้ด ส่งกลับไปให้ฟอร์มกรอกให้
export async function readPurchaseDocument(projectId: string, fd: FormData): Promise<ActionResult<PurchaseDocumentResult>> {
  await requireUser()
  const supabase = await createClient()
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return fail('กรุณาเลือกรูปหรือไฟล์ PDF')
  if (!(DOC_TYPES as readonly string[]).includes(file.type)) return fail('รองรับรูป JPG PNG WEBP และไฟล์ PDF')
  if (file.size > 4 * 1024 * 1024) return fail('ไฟล์ใหญ่เกิน 4MB')

  const { data: summary } = await supabase.from('v_project_summary').select('confirmed_version_id').eq('project_id', projectId).maybeSingle()
  if (!summary?.confirmed_version_id) return fail('โครงการนี้ยังไม่มี BOQ ที่ยืนยัน')
  const { data: boq } = await supabase
    .from('boq_items')
    .select('id, description, unit')
    .eq('boq_version_id', summary.confirmed_version_id)
    .gte('qty', 0)
    .order('sort_order')

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
  const path = `projects/${projectId}/purchases/${safeObjectName(file.name || `document.${ext}`, ext)}`
  const { error: upErr } = await supabase.storage.from('project-files').upload(path, buffer, { contentType: file.type })
  if (upErr) return fail(`อัปโหลดไฟล์ไม่สำเร็จ: ${upErr.message}`)

  const empty: PurchaseDocumentResult = {
    attachment_path: path, read_error: null, supplier_name: null, document_no: null, document_date: null,
    grand_total: null, total_excl_vat: null, lines: [], issues: [], notes: [], warnings: [],
  }
  const outcome = await extractPurchaseDocument({ data: buffer.toString('base64'), mediaType: file.type as DocType }, boq ?? [])
  if (outcome.status === 'off') return { ok: true, data: { ...empty, read_error: 'ระบบยังเรียก Claude ไม่ได้ เพราะไม่พบ ANTHROPIC_API_KEY บนเซิร์ฟเวอร์' } }
  if (outcome.status === 'failed') return { ok: true, data: { ...empty, read_error: `เรียก Claude ไม่สำเร็จ (${outcome.reason})` } }
  const doc = outcome.doc
  if (!doc.is_purchase_document || doc.lines.length === 0) {
    return { ok: true, data: { ...empty, read_error: 'ไม่พบรายการสินค้าในเอกสารนี้ ตรวจว่าเป็นใบสั่งซื้อ ใบกำกับภาษี หรือใบเสร็จ และรูปชัดพอ' } }
  }
  const review = reviewExtraction(doc, boq ?? [])
  return {
    ok: true,
    data: {
      ...empty,
      supplier_name: doc.supplier_name,
      document_no: doc.document_no,
      document_date: doc.document_date,
      grand_total: doc.grand_total,
      total_excl_vat: review.total_excl_vat,
      lines: review.lines,
      issues: review.issues,
      notes: review.notes,
      warnings: doc.warnings.slice(0, 4),
    },
  }
}
