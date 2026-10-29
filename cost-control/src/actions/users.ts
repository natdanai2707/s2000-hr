'use server'

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROLE_LABELS, type UserRole } from '@/lib/types'
import { fail, type ActionResult } from './types'

// จัดการผู้ใช้ ทำได้เฉพาะฝ่ายบริหารและผู้ดูแลระบบ ใช้ service role เพราะต้องสร้างบัญชีใน Supabase Auth
// ตรวจสิทธิ์ผู้เรียกที่นี่ทุกครั้งก่อนใช้ service role

const ROLES = Object.keys(ROLE_LABELS) as UserRole[]

async function requireManager() {
  const user = await requireUser()
  if (user.profile.role !== 'management' && user.profile.role !== 'admin') return null
  return user
}

// รหัสผ่านชั่วคราวอ่านง่าย ไม่มีตัวที่สับสน (0 O 1 l I)
function tempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('')
}

export async function createUserAccount(fd: FormData): Promise<ActionResult<{ email: string; password: string }>> {
  const me = await requireManager()
  if (!me) return fail('เฉพาะฝ่ายบริหารและผู้ดูแลระบบเท่านั้น')
  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const fullName = String(fd.get('full_name') ?? '').trim()
  const role = String(fd.get('role') ?? '') as UserRole
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('อีเมลไม่ถูกต้อง')
  if (!fullName) return fail('กรุณากรอกชื่อ')
  if (!ROLES.includes(role)) return fail('กรุณาเลือกสิทธิ์')
  if (role === 'admin' && me.profile.role !== 'admin') return fail('เฉพาะผู้ดูแลระบบเท่านั้นที่ให้สิทธิ์ผู้ดูแลระบบได้')

  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    return fail(e)
  }
  const password = tempPassword()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    // สิทธิ์ใส่ใน app_metadata ซึ่งผู้ใช้แก้เองไม่ได้ ฐานข้อมูลอ่านจากที่นี่และเปิดบัญชีให้ทันที
    app_metadata: { role },
  })
  if (error) return fail(/already/i.test(error.message) ? `อีเมล ${email} มีบัญชีอยู่แล้ว` : error.message)
  // trigger สร้างโปรไฟล์ให้แล้ว ตั้งชื่อและสิทธิ์ซ้ำเผื่อ trigger อ่าน metadata ไม่ได้
  const { error: profErr } = await admin.from('profiles').upsert({ id: data.user.id, full_name: fullName, role, is_active: true })
  if (profErr) return fail(profErr)
  revalidatePath('/admin/users')
  return { ok: true, data: { email, password } }
}

export async function updateUserAccount(id: string, patch: { full_name?: string; role?: UserRole; is_active?: boolean }): Promise<ActionResult> {
  const me = await requireManager()
  if (!me) return fail('เฉพาะฝ่ายบริหารและผู้ดูแลระบบเท่านั้น')
  if (id === me.id && (patch.role !== undefined || patch.is_active === false)) return fail('เปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้')
  if (patch.role !== undefined && !ROLES.includes(patch.role)) return fail('สิทธิ์ไม่ถูกต้อง')
  if (patch.full_name !== undefined && !patch.full_name.trim()) return fail('กรุณากรอกชื่อ')
  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    return fail(e)
  }
  const { data: target } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
  if (!target) return fail('ไม่พบผู้ใช้')
  if ((patch.role === 'admin' || target.role === 'admin') && me.profile.role !== 'admin') return fail('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้บัญชีผู้ดูแลระบบได้')
  const { error } = await admin
    .from('profiles')
    .update({ ...patch, ...(patch.full_name !== undefined ? { full_name: patch.full_name.trim() } : {}) })
    .eq('id', id)
  if (error) return fail(error)
  // เปิดบัญชีที่สมัครเองแล้ว ไม่ถือเป็นคำขอรออนุมัติอีก แม้ภายหลังจะถูกปิดบัญชี
  if (patch.is_active === true) await admin.auth.admin.updateUserById(id, { user_metadata: { self_registered: false } })
  revalidatePath('/admin/users')
  return { ok: true, data: undefined }
}

export async function resetUserPassword(id: string): Promise<ActionResult<{ password: string }>> {
  const me = await requireManager()
  if (!me) return fail('เฉพาะฝ่ายบริหารและผู้ดูแลระบบเท่านั้น')
  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    return fail(e)
  }
  const { data: target } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
  if (!target) return fail('ไม่พบผู้ใช้')
  if (target.role === 'admin' && me.profile.role !== 'admin') return fail('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้บัญชีผู้ดูแลระบบได้')
  const password = tempPassword()
  const { error } = await admin.auth.admin.updateUserById(id, { password })
  if (error) return fail(error.message)
  return { ok: true, data: { password } }
}
