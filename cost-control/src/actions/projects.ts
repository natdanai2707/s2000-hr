'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireUser } from '@/lib/auth'
import { fail, type ActionResult } from './types'

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim()
}
function num(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}
function dateOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key)
  return v ? v : null
}

export async function createProject(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole(['management', 'admin', 'project_manager'])
  const supabase = await createClient()
  const code = str(fd, 'code')
  const name = str(fd, 'name')
  if (!code || !name) return fail('กรุณากรอกรหัสและชื่อโครงการ')
  const { data, error } = await supabase
    .from('projects')
    .insert({
      code,
      name,
      customer_name: str(fd, 'customer_name') || null,
      branch_id: str(fd, 'branch_id'),
      contract_value: num(fd, 'contract_value'),
      start_date: dateOrNull(fd, 'start_date'),
      planned_end_date: dateOrNull(fd, 'planned_end_date'),
      retention_pct: num(fd, 'retention_pct'),
      penalty_per_day: num(fd, 'penalty_per_day'),
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return fail(error)
  // ผู้สร้างเป็นสมาชิกโครงการอัตโนมัติ
  await supabase.from('project_members').insert({ project_id: data.id, user_id: user.id, role_in_project: user.profile.role, created_by: user.id })
  revalidatePath('/projects')
  return { ok: true, data: { id: data.id } }
}

const PROJECT_STATUSES = ['draft', 'active', 'closing', 'closed'] as const

export async function updateProject(projectId: string, fd: FormData): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const name = str(fd, 'name')
  if (!name) return fail('กรุณากรอกชื่อโครงการ')

  const status = str(fd, 'status')
  const patch: Record<string, unknown> = {
    name,
    customer_name: str(fd, 'customer_name') || null,
    branch_id: str(fd, 'branch_id'),
    contract_value: num(fd, 'contract_value'),
    start_date: dateOrNull(fd, 'start_date'),
    planned_end_date: dateOrNull(fd, 'planned_end_date'),
    retention_pct: num(fd, 'retention_pct'),
    penalty_per_day: num(fd, 'penalty_per_day'),
  }
  if ((PROJECT_STATUSES as readonly string[]).includes(status)) patch.status = status

  // ต้องเช็คว่ามีแถวกลับมาจริง เพราะถ้า RLS ปฏิเสธ Supabase จะไม่คืน error แต่ไม่มีอะไรถูกแก้
  const { data, error } = await supabase.from('projects').update(patch).eq('id', projectId).select('id')
  if (error) return fail(error)
  if (!data || data.length === 0) return fail('ไม่มีสิทธิ์แก้ไขโครงการนี้ หรือไม่พบโครงการ')

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  revalidatePath('/')
  return { ok: true, data: undefined }
}

export async function addProjectMember(projectId: string, userId: string, roleInProject: string): Promise<ActionResult> {
  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase
    .from('project_members')
    .upsert({ project_id: projectId, user_id: userId, role_in_project: roleInProject, created_by: user.id })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, data: undefined }
}

export async function removeProjectMember(projectId: string, userId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId)
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, data: undefined }
}

export interface ProjectDeleteBlocker {
  label: string
  count: number
}

// นับเอกสารต้นทุนที่ผูกกับโครงการ ถ้ามีแม้ชิ้นเดียวจะลบโครงการไม่ได้
async function countProjectDocuments(projectId: string): Promise<ProjectDeleteBlocker[]> {
  const supabase = await createClient()
  const head = { count: 'exact' as const, head: true }
  const [pr, po, invoice, expense, agreement] = await Promise.all([
    supabase.from('purchase_requests').select('id', head).eq('project_id', projectId),
    supabase.from('purchase_orders').select('id', head).eq('project_id', projectId),
    supabase.from('invoices').select('id', head).eq('project_id', projectId),
    supabase.from('expenses').select('id', head).eq('project_id', projectId),
    supabase.from('subcontract_agreements').select('id', head).eq('project_id', projectId),
  ])
  return [
    { label: 'ใบขอซื้อ', count: pr.count ?? 0 },
    { label: 'ใบสั่งซื้อ', count: po.count ?? 0 },
    { label: 'ใบแจ้งหนี้', count: invoice.count ?? 0 },
    { label: 'ค่าใช้จ่าย', count: expense.count ?? 0 },
    { label: 'สัญญาผู้รับเหมาช่วง', count: agreement.count ?? 0 },
  ].filter(x => x.count > 0)
}

export async function getProjectDeleteBlockers(projectId: string): Promise<ActionResult<ProjectDeleteBlocker[]>> {
  await requireRole(['management', 'admin'])
  return { ok: true, data: await countProjectDocuments(projectId) }
}

// ลบโครงการถาวร พร้อม BOQ ทุกเวอร์ชันและรายชื่อสมาชิก
// ปฏิเสธถ้ามีเอกสารต้นทุนผูกอยู่ และบังคับให้พิมพ์รหัสโครงการยืนยัน เพราะย้อนกลับไม่ได้
export async function deleteProject(projectId: string, confirmCode: string): Promise<ActionResult> {
  await requireRole(['management', 'admin'])
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id, code, name').eq('id', projectId).maybeSingle()
  if (!project) return fail('ไม่พบโครงการนี้')
  if (confirmCode.trim() !== project.code) return fail(`กรุณาพิมพ์รหัสโครงการ ${project.code} ให้ตรงเพื่อยืนยัน`)

  const blockers = await countProjectDocuments(projectId)
  if (blockers.length > 0) {
    const detail = blockers.map(b => `${b.label} ${b.count} รายการ`).join(' · ')
    return fail(
      `ลบไม่ได้ โครงการนี้มีเอกสารต้นทุนผูกอยู่แล้ว (${detail}) ` +
        'เอกสารเหล่านี้เป็นบันทึกทางการเงินที่มีประวัติการแก้ไขผูกอยู่ ถ้าต้องการเลิกใช้โครงการ ให้เปลี่ยนสถานะเป็นปิดแทนการลบ'
    )
  }

  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) return fail(error)

  revalidatePath('/projects')
  revalidatePath('/')
  return { ok: true, data: undefined }
}
