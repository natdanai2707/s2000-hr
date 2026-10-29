'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'

// ผู้ใช้ใหม่ได้รหัสผ่านชั่วคราวจากหน้าผู้ใช้และสิทธิ์ เปลี่ยนเป็นของตัวเองที่นี่
export function ChangePasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDone(false)
    if (password.length < 8) return setError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
    if (password !== confirm) return setError('รหัสผ่านสองช่องไม่ตรงกัน')
    setPending(true)
    setError(null)
    const { error } = await createClient().auth.updateUser({ password })
    setPending(false)
    if (error) return setError(/different from the old/i.test(error.message) ? 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม' : error.message)
    setPassword('')
    setConfirm('')
    setDone(true)
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-4 space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">เปลี่ยนรหัสผ่านแล้ว ครั้งหน้าเข้าระบบด้วยรหัสใหม่</Alert>}
      <FormField label="รหัสผ่านใหม่">
        <Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
      </FormField>
      <FormField label="ยืนยันรหัสผ่านใหม่">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'กำลังบันทึก' : 'เปลี่ยนรหัสผ่าน'}</Button>
    </form>
  )
}
