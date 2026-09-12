'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { fail, type ActionResult } from './types'

export interface PoPriceOverride {
  pr_item_id: string
  unit_price: number
}

// แปลง PR ที่อนุมัติเป็น PO ถ้าแก้ราคาแพงขึ้นเกิน threshold DB จะส่ง PR กลับไปอนุมัติใหม่ (คืน po_id = null)
export async function createPoFromPr(prId: string, supplierId: string | null, prices: PoPriceOverride[]): Promise<ActionResult<{ po_id: string | null }>> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_po_from_pr', {
    p_pr_id: prId,
    p_supplier_id: supplierId,
    p_prices: prices,
  })
  if (error) return fail(error)
  revalidatePath('/po')
  revalidatePath('/pr')
  revalidatePath(`/pr/${prId}`)
  return { ok: true, data: { po_id: (data as string | null) ?? null } }
}

export async function cancelPurchaseOrder(poId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { count } = await supabase.from('goods_receipts').select('id', { count: 'exact', head: true }).eq('po_id', poId)
  if ((count ?? 0) > 0) return fail('PO นี้มีการรับของแล้ว ยกเลิกไม่ได้')
  const { error } = await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', poId)
  if (error) return fail(error)
  revalidatePath('/po')
  revalidatePath(`/po/${poId}`)
  return { ok: true, data: undefined }
}

export async function createSupplier(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const name = String(fd.get('name') ?? '').trim()
  if (!name) return fail('กรุณากรอกชื่อซัพพลายเออร์')
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      name,
      tax_id: String(fd.get('tax_id') ?? '').trim() || null,
      phone: String(fd.get('phone') ?? '').trim() || null,
      note: String(fd.get('note') ?? '').trim() || null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)
  revalidatePath('/po')
  return { ok: true, data: { id: data.id } }
}
