'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { notify, userManagerIds } from '@/lib/notifications'
import { fail, type ActionResult } from './types'

// สมัครใช้งานเอง ไม่ต้อง login สร้างบัญชีด้วย service role แบบยืนยันอีเมลแล้ว (ไม่ต้องพึ่งอีเมลของ Supabase)
// บัญชีเริ่มเป็นวิศวกรและยังไม่เปิดใช้งาน ฝ่ายบริหารเลือกสิทธิ์และเปิดบัญชีที่หน้าผู้ใช้และสิทธิ์
export async function registerAccount(fd: FormData): Promise<ActionResult> {
  // ช่องซ่อนที่คนไม่เห็น บอทกรอก
  if (String(fd.get('website') ?? '')) return { ok: true, data: undefined }
  const fullName = String(fd.get('full_name') ?? '').trim().slice(0, 120)
  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const password = String(fd.get('password') ?? '')
  const note = String(fd.get('note') ?? '').trim().slice(0, 300)
  if (!fullName) return fail('กรุณากรอกชื่อ')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('อีเมลไม่ถูกต้อง')
  if (password.length < 8) return fail('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return fail('ระบบยังเปิดรับสมัครไม่ได้ ติดต่อฝ่ายบริหาร')
  }
  // ไม่ใส่ role ใน app_metadata ฐานข้อมูลจึงสร้างโปรไฟล์แบบยังไม่เปิดใช้งาน
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, signup_note: note || null, self_registered: true },
  })
  if (error) return fail(/already/i.test(error.message) ? 'อีเมลนี้สมัครไว้แล้ว เข้าสู่ระบบหรือติดต่อฝ่ายบริหาร' : 'สมัครไม่สำเร็จ ลองใหม่อีกครั้ง')

  await notify({
    event: 'user_registered',
    userIds: await userManagerIds(),
    title: `${fullName} สมัครใช้งาน รออนุมัติ`,
    body: note || email,
    link: '/admin/users',
  })
  return { ok: true, data: undefined }
}
