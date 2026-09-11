'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { notify } from '@/lib/notifications'
import { fail, type ActionResult } from './types'

export interface ReceiptLineInput {
  po_item_id: string
  boq_item_id: string
  qty_received: number
  unit_cost: number
}

// ยืนยันรับของ (รับบางส่วนได้) แนบรูปได้ source = internal_stock ใช้ราคาทุน
export async function confirmGoodsReceipt(poId: string, fd: FormData, lines: ReceiptLineInput[]): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const valid = lines.filter(l => l.qty_received > 0)
  if (valid.length === 0) return fail('กรุณาระบุปริมาณที่รับอย่างน้อย 1 รายการ')

  const { data: po } = await supabase.from('purchase_orders').select('id, po_no, project_id, status, created_by, projects(name)').eq('id', poId).single()
  if (!po) return fail('ไม่พบใบสั่งซื้อ')
  if (po.status === 'cancelled') return fail('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว')

  let attachmentPath: string | null = null
  const file = fd.get('attachment')
  if (file instanceof File && file.size > 0) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    attachmentPath = `projects/${po.project_id}/receipts/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('project-files').upload(attachmentPath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'image/jpeg',
    })
    if (upErr) return fail(`อัปโหลดรูปไม่สำเร็จ: ${upErr.message}`)
  }

  const source = String(fd.get('source') ?? 'supplier') === 'internal_stock' ? 'internal_stock' : 'supplier'
  const { data: receipt, error } = await supabase
    .from('goods_receipts')
    .insert({
      po_id: poId,
      received_by: user.id,
      received_at: new Date().toISOString(),
      source,
      note: String(fd.get('note') ?? '').trim() || null,
      attachment_path: attachmentPath,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)

  const { error: itemErr } = await supabase.from('goods_receipt_items').insert(
    valid.map(l => ({
      receipt_id: receipt.id,
      po_item_id: l.po_item_id,
      boq_item_id: l.boq_item_id,
      qty_received: l.qty_received,
      unit_cost: l.unit_cost,
      created_by: user.id,
    }))
  )
  if (itemErr) {
    await supabase.from('goods_receipts').delete().eq('id', receipt.id)
    return fail(itemErr)
  }

  const projectName = (po.projects as unknown as { name: string } | null)?.name ?? ''
  const { data: purchasing } = await supabase.from('profiles').select('id').eq('role', 'purchasing').eq('is_active', true)
  await notify({
    event: 'goods_received',
    userIds: [...(purchasing ?? []).map(p => p.id), ...(po.created_by ? [po.created_by] : [])],
    title: `รับของแล้ว ${po.po_no}`,
    body: `${projectName} โดย ${user.profile.full_name}`,
    link: `/po/${poId}`,
  })

  revalidatePath('/receiving')
  revalidatePath(`/po/${poId}`)
  revalidatePath(`/projects/${po.project_id}`)
  return { ok: true, data: { id: receipt.id } }
}
