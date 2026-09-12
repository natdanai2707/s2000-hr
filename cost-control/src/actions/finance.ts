'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { fail, type ActionResult } from './types'

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? '').trim()
}
function num(fd: FormData, key: string) {
  const n = Number(str(fd, key).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

export async function createInvoice(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const poId = str(fd, 'po_id') || null
  const agreementId = str(fd, 'agreement_id') || null
  if (!poId && !agreementId) return fail('กรุณาเลือกใบสั่งซื้อหรือสัญญาผู้รับเหมาช่วง')
  const amount = num(fd, 'amount')
  if (!(amount > 0)) return fail('จำนวนเงินต้องมากกว่า 0')
  const invoiceNo = str(fd, 'invoice_no')
  if (!invoiceNo) return fail('กรุณากรอกเลขที่ใบแจ้งหนี้')

  let projectId = str(fd, 'project_id')
  let supplierId = str(fd, 'supplier_id') || null
  if (poId) {
    const { data: po } = await supabase.from('purchase_orders').select('project_id, supplier_id').eq('id', poId).single()
    if (!po) return fail('ไม่พบใบสั่งซื้อ')
    projectId = po.project_id
    supplierId = supplierId ?? po.supplier_id
  }
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      supplier_id: supplierId,
      project_id: projectId,
      po_id: poId,
      agreement_id: agreementId,
      invoice_no: invoiceNo,
      invoice_date: str(fd, 'invoice_date') || new Date().toISOString().slice(0, 10),
      amount,
      due_date: str(fd, 'due_date') || null,
      status: 'received',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)
  revalidatePath('/finance')
  return { ok: true, data: { id: data.id } }
}

export async function approveInvoice(invoiceId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('invoices').update({ status: 'approved' }).eq('id', invoiceId).eq('status', 'received')
  if (error) return fail(error)
  revalidatePath('/finance')
  return { ok: true, data: undefined }
}

export async function recordPayment(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const invoiceId = str(fd, 'invoice_id')
  const amount = num(fd, 'amount')
  if (!invoiceId) return fail('กรุณาเลือกใบแจ้งหนี้')
  if (!(amount > 0)) return fail('จำนวนเงินต้องมากกว่า 0')
  const { data, error } = await supabase
    .from('payments')
    .insert({
      invoice_id: invoiceId,
      paid_at: str(fd, 'paid_at') || new Date().toISOString().slice(0, 10),
      amount,
      method: str(fd, 'method') || null,
      reference_no: str(fd, 'reference_no') || null,
      recorded_by: user.id,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)
  revalidatePath('/finance')
  return { ok: true, data: { id: data.id } }
}
