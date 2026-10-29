'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { fail, type ActionResult } from './types'

// วางบิลลูกค้าและบันทึกเงินเข้า สิทธิ์บันทึกและแก้ไขตรวจซ้ำด้วย RLS (บัญชี ฝ่ายบริหาร ผู้ดูแลระบบ)

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? '').trim()
}
function money(fd: FormData, key: string) {
  const raw = str(fd, key).replace(/,/g, '')
  if (raw === '') return 0
  const n = Number(raw)
  return isNaN(n) ? NaN : Math.round(n * 100) / 100
}

function refresh(projectId?: string | null) {
  revalidatePath('/billing')
  revalidatePath('/')
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

function billingInput(fd: FormData) {
  const amount = money(fd, 'amount')
  const vat = money(fd, 'vat_amount')
  if (!(amount > 0)) return 'ยอดวางบิล (ไม่รวม VAT) ต้องมากกว่า 0'
  if (!(vat >= 0)) return 'VAT ไม่ถูกต้อง'
  const billedDate = str(fd, 'billed_date')
  if (!billedDate) return 'กรุณาระบุวันที่วางบิล'
  return {
    installment: str(fd, 'installment') || null,
    billed_date: billedDate,
    due_date: str(fd, 'due_date') || null,
    amount,
    vat_amount: vat,
    note: str(fd, 'note') || null,
  }
}

export async function createBilling(fd: FormData): Promise<ActionResult<{ id: string; billing_no: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const projectId = str(fd, 'project_id')
  if (!projectId) return fail('กรุณาเลือกโครงการ')
  const input = billingInput(fd)
  if (typeof input === 'string') return fail(input)
  // เลขที่ตามเอกสารจริงถ้ากรอกมา ไม่งั้นให้ระบบออกเลข
  let billingNo = str(fd, 'billing_no')
  if (!billingNo) {
    const { data, error } = await supabase.rpc('next_document_no', { p_type: 'BL' })
    if (error) return fail(error)
    billingNo = data as string
  }
  const { data, error } = await supabase
    .from('customer_billings')
    .insert({ ...input, project_id: projectId, billing_no: billingNo, created_by: user.id })
    .select('id, billing_no')
    .single()
  if (error) return fail(error.code === '23505' ? `เลขที่ ${billingNo} มีอยู่แล้ว` : error)
  refresh(projectId)
  return { ok: true, data }
}

export async function updateBilling(id: string, fd: FormData): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const input = billingInput(fd)
  if (typeof input === 'string') return fail(input)
  const billingNo = str(fd, 'billing_no')
  const { data, error } = await supabase
    .from('customer_billings')
    .update({ ...input, ...(billingNo ? { billing_no: billingNo } : {}) })
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return fail(error.code === '23505' ? `เลขที่ ${billingNo} มีอยู่แล้ว` : error)
  refresh(data.project_id)
  return { ok: true, data: undefined }
}

export async function voidBilling(id: string, reason: string): Promise<ActionResult> {
  await requireUser()
  if (!reason.trim()) return fail('กรุณาระบุเหตุผลที่ยกเลิก')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customer_billings')
    .update({ voided_at: new Date().toISOString(), void_reason: reason.trim() })
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return fail(error)
  refresh(data.project_id)
  return { ok: true, data: undefined }
}

function receiptInput(fd: FormData) {
  const release = str(fd, 'is_retention_release') === '1'
  const values = {
    received_date: str(fd, 'received_date'),
    amount_received: money(fd, 'amount_received'),
    withholding_tax: release ? 0 : money(fd, 'withholding_tax'),
    retention: release ? 0 : money(fd, 'retention'),
    other_deduction: release ? 0 : money(fd, 'other_deduction'),
    is_retention_release: release,
    note: str(fd, 'note') || null,
  }
  if (!values.received_date) return 'กรุณาระบุวันที่รับเงิน'
  const parts = [values.amount_received, values.withholding_tax, values.retention, values.other_deduction]
  if (parts.some(v => !(v >= 0))) return 'จำนวนเงินไม่ถูกต้อง'
  if (parts.reduce((a, b) => a + b, 0) <= 0) return 'กรุณากรอกจำนวนเงินที่ได้รับ'
  return values
}

// billing_id ว่าง = เงินเข้าที่ไม่ผูกบิล เช่น ลูกค้าคืนเงินประกันผลงาน ต้องระบุโครงการ
export async function recordReceipt(fd: FormData): Promise<ActionResult> {
  const user = await requireUser()
  const supabase = await createClient()
  const billingId = str(fd, 'billing_id') || null
  let projectId = str(fd, 'project_id')
  if (billingId) {
    const { data: bill } = await supabase.from('customer_billings').select('project_id').eq('id', billingId).maybeSingle()
    if (!bill) return fail('ไม่พบใบวางบิล')
    projectId = bill.project_id
  }
  if (!projectId) return fail('กรุณาเลือกโครงการ')
  const input = receiptInput(fd)
  if (typeof input === 'string') return fail(input)
  if (input.is_retention_release && billingId) return fail('การคืนเงินประกันผลงานไม่ต้องผูกกับบิล')
  const { error } = await supabase.from('customer_receipts').insert({ ...input, billing_id: billingId, project_id: projectId, created_by: user.id })
  if (error) return fail(error)
  refresh(projectId)
  return { ok: true, data: undefined }
}

export async function updateReceipt(id: string, fd: FormData): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const input = receiptInput(fd)
  if (typeof input === 'string') return fail(input)
  const { data: current } = await supabase.from('customer_receipts').select('billing_id').eq('id', id).maybeSingle()
  if (!current) return fail('ไม่พบรายการรับเงิน')
  if (input.is_retention_release && current.billing_id) return fail('การคืนเงินประกันผลงานไม่ต้องผูกกับบิล')
  const { data, error } = await supabase.from('customer_receipts').update(input).eq('id', id).select('project_id').single()
  if (error) return fail(error)
  refresh(data.project_id)
  return { ok: true, data: undefined }
}

export async function deleteReceipt(id: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.from('customer_receipts').delete().eq('id', id).select('project_id').maybeSingle()
  if (error) return fail(error)
  if (!data) return fail('ลบไม่ได้ ไม่พบรายการหรือไม่มีสิทธิ์')
  refresh(data.project_id)
  return { ok: true, data: undefined }
}
