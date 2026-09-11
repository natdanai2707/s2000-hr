'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { fail, type ActionResult } from './types'

// ค่าใช้จ่ายเบ็ดเตล็ดที่ไม่ผ่าน PO นับเป็น actual และ paid พร้อมกัน ต้องผูก BOQ item เสมอ
export async function createExpense(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()
  const projectId = String(fd.get('project_id') ?? '').trim()
  const boqItemId = String(fd.get('boq_item_id') ?? '').trim()
  const amount = Number(String(fd.get('amount') ?? '').replace(/,/g, ''))
  const description = String(fd.get('description') ?? '').trim()
  const reason = String(fd.get('variance_reason') ?? '').trim()
  const isOffBoq = String(fd.get('is_off_boq') ?? '') === 'true'
  if (!projectId) return fail('กรุณาเลือกโครงการ')
  if (!boqItemId) return fail('กรุณาเลือกรายการ BOQ')
  if (!(amount > 0)) return fail('จำนวนเงินต้องมากกว่า 0')
  if (!description) return fail('กรุณากรอกรายละเอียด')
  if (isOffBoq && !reason) return fail('รายการนอก BOQ ต้องระบุเหตุผล')

  let attachmentPath: string | null = null
  const file = fd.get('attachment')
  if (file instanceof File && file.size > 0) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    attachmentPath = `projects/${projectId}/expenses/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('project-files').upload(attachmentPath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream',
    })
    if (upErr) return fail(`อัปโหลดไฟล์ไม่สำเร็จ: ${upErr.message}`)
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      project_id: projectId,
      boq_item_id: boqItemId,
      expense_date: String(fd.get('expense_date') ?? '') || new Date().toISOString().slice(0, 10),
      amount,
      description: isOffBoq ? `${description} (เหตุผลนอก BOQ: ${reason})` : description,
      paid_by: user.id,
      attachment_path: attachmentPath,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { ok: true, data: { id: data.id } }
}
