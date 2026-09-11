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

export async function updateProject(projectId: string, fd: FormData): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase
    .from('projects')
    .update({
      name: str(fd, 'name'),
      customer_name: str(fd, 'customer_name') || null,
      branch_id: str(fd, 'branch_id'),
      contract_value: num(fd, 'contract_value'),
      start_date: dateOrNull(fd, 'start_date'),
      planned_end_date: dateOrNull(fd, 'planned_end_date'),
      retention_pct: num(fd, 'retention_pct'),
      penalty_per_day: num(fd, 'penalty_per_day'),
    })
    .eq('id', projectId)
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
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
