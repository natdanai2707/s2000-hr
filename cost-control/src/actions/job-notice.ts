'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'
import { readSheets } from '@/lib/boq/parse'
import { parseJobNotice, projectNameFromNotice, matchProfile, customerFromCells } from '@/lib/project/job-notice'
import { ROLE_LABELS, type UserRole } from '@/lib/types'
import { fail, type ActionResult } from './types'

const OPENERS = ['management', 'admin', 'project_manager'] as const

export interface JobNoticePerson {
  role: UserRole
  label: string
  name: string
  user_id: string | null
}

export interface JobNoticeDraft {
  code: string
  name: string
  customer_name: string
  branch_id: string
  people: JobNoticePerson[]
  duplicate: { id: string; name: string } | null
  notes: string[]
}

export interface ProfileOption {
  id: string
  full_name: string
  role: UserRole
}

function cellText(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown }
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join('')
    if (typeof o.result === 'string') return o.result
    if (typeof o.text === 'string') return o.text
  }
  return null
}

// อ่านข้อความแจ้งเปิด Job (และไฟล์ BOQ ถ้าแนบ) เป็นร่างโครงการ ยังไม่บันทึกอะไร ให้ผู้ใช้ตรวจก่อน
export async function readJobNotice(fd: FormData): Promise<ActionResult<JobNoticeDraft>> {
  await requireRole([...OPENERS])
  const text = String(fd.get('text') ?? '')
  if (!text.trim()) return fail('วางข้อความแจ้งเปิด Job ก่อน')
  const n = parseJobNotice(text)
  if (!n.code) return fail('ไม่พบรหัสงานในข้อความ เช่น A6911-05 ตรวจว่าพิมพ์รหัสงานไว้หรือไม่')

  const supabase = await createClient()
  const [{ data: profiles }, { data: branches }, { data: dup }, { data: customers }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    supabase.from('branches').select('id, code'),
    supabase.from('projects').select('id, name').eq('code', n.code).maybeSingle(),
    n.customer_hint
      ? supabase.from('projects').select('customer_name').ilike('customer_name', `%${n.customer_hint}%`).limit(20)
      : Promise.resolve({ data: [] as { customer_name: string | null }[] }),
  ])
  const notes: string[] = []

  // ชื่อลูกค้าเต็ม: จากไฟล์ BOQ ก่อน ไม่มีไฟล์ใช้ชื่อจากโครงการเก่าของลูกค้ารายเดียวกัน
  let customer: string | null = null
  const file = fd.get('file')
  if (file instanceof File && file.size > 0 && n.customer_hint) {
    try {
      const sheets = await readSheets(Buffer.from(await file.arrayBuffer()))
      const cells: string[] = []
      for (const s of sheets) for (const row of s.grid.slice(0, 60)) for (const c of row) {
        const t = cellText(c)
        if (t) cells.push(t)
      }
      customer = customerFromCells(n.customer_hint, cells)
    } catch {
      notes.push('เปิดไฟล์ BOQ เพื่ออ่านชื่อลูกค้าไม่ได้ ตรวจชื่อลูกค้าเอง')
    }
  }
  if (!customer) customer = customerFromCells(n.customer_hint, (customers ?? []).map(c => c.customer_name ?? ''))
  if (!customer && n.customer_hint) notes.push(`ใช้ชื่อลูกค้าย่อ "${n.customer_hint}" ตามข้อความ แก้เป็นชื่อเต็มได้`)

  // สาขาจากตัวอักษรหน้ารหัสงาน เช่น A = เอเชีย (ASIA)
  const branch = (branches ?? []).find(b => b.code?.[0]?.toUpperCase() === n.code![0])

  const people: JobNoticePerson[] = n.people.map(p => {
    const hit = matchProfile(p.name, p.role, (profiles ?? []) as ProfileOption[])
    if (!hit) notes.push(`ไม่พบผู้ใช้ชื่อ ${p.name} (${p.label}) เลือกจากรายชื่อ หรือเว้นไว้แล้วเพิ่มทีหลัง`)
    return { role: p.role, label: p.label, name: p.name, user_id: hit?.id ?? null }
  })

  return {
    ok: true,
    data: {
      code: n.code,
      name: projectNameFromNotice(n),
      customer_name: customer ?? n.customer_hint ?? '',
      branch_id: branch?.id ?? '',
      people,
      duplicate: dup ? { id: dup.id, name: dup.name } : null,
      notes,
    },
  }
}

// เปิดงาน: สร้างโครงการ แล้วใส่ผู้สร้างและคนตามข้อความเป็นสมาชิกโครงการ
// สร้างโครงการด้วยสิทธิ์ของผู้ใช้ (policy อนุญาตเฉพาะฝ่ายบริหาร ผู้ดูแลระบบ ผู้จัดการโครงการ)
// สมาชิกชุดแรกใส่ด้วย service role เพราะผู้จัดการโครงการยังไม่เป็นสมาชิกตอนสร้าง policy ของ project_members จึงยังไม่ให้เพิ่ม
export async function openJob(input: {
  code: string
  name: string
  customer_name: string
  branch_id: string
  start_date: string | null
  members: { user_id: string; role: UserRole }[]
}): Promise<ActionResult<{ id: string; warning: string | null }>> {
  const user = await requireRole([...OPENERS])
  const code = input.code.trim().toUpperCase()
  const name = input.name.trim()
  if (!code || !name) return fail('กรุณากรอกรหัสและชื่อโครงการ')
  if (!input.branch_id) return fail('กรุณาเลือกสาขา')
  const supabase = await createClient()
  const id = randomUUID()
  const { error } = await supabase.from('projects').insert({
    id,
    code,
    name,
    customer_name: input.customer_name.trim() || null,
    branch_id: input.branch_id,
    contract_value: 0,
    start_date: input.start_date && /^\d{4}-\d{2}-\d{2}$/.test(input.start_date) ? input.start_date : null,
    created_by: user.id,
  })
  if (error) return fail(error.code === '23505' ? `รหัสงาน ${code} มีอยู่แล้ว` : error)

  const rows = new Map<string, string>([[user.id, user.profile.role]])
  for (const m of input.members) if (m.user_id && m.role in ROLE_LABELS && !rows.has(m.user_id)) rows.set(m.user_id, m.role)
  const { error: memErr } = await createAdminClient()
    .from('project_members')
    .insert([...rows].map(([user_id, role]) => ({ project_id: id, user_id, role_in_project: role, created_by: user.id })))
  revalidatePath('/projects')
  revalidatePath('/')
  return { ok: true, data: { id, warning: memErr ? `เพิ่มสมาชิกโครงการไม่สำเร็จ (${memErr.message}) เพิ่มได้ที่หน้าโครงการ` : null } }
}
