'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createUserAccount, updateUserAccount, resetUserPassword } from '@/actions/users'
import { ROLE_HINTS, ROLE_LABELS, type UserRole } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from './common'

function PasswordNotice({ email, password }: { email?: string; password: string }) {
  return (
    <Alert tone="success">
      <div>รหัสผ่านชั่วคราว แสดงครั้งเดียว ส่งให้เจ้าของบัญชีแล้วให้เปลี่ยนที่เมนู เปลี่ยนรหัสผ่าน หลังเข้าระบบ</div>
      {email && <div className="mt-1">อีเมล: <span className="font-mono">{email}</span></div>}
      <div className="mt-1">
        รหัสผ่าน: <span className="font-mono text-base select-all">{password}</span>
      </div>
    </Alert>
  )
}

export function AddUserDialog({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<UserRole>('management')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createUserAccount(new FormData(e.currentTarget))
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreated(res.data)
    router.refresh()
  }

  return (
    <>
      <Button onClick={() => { setCreated(null); setError(null); setOpen(true) }}>เพิ่มผู้ใช้</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>เพิ่มผู้ใช้</DialogTitle></DialogHeader>
          {created ? (
            <div className="space-y-3">
              <PasswordNotice email={created.email} password={created.password} />
              <div className="flex justify-end"><Button onClick={() => setOpen(false)}>เสร็จ</Button></div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              {error && <Alert tone="danger">{error}</Alert>}
              <FormField label="ชื่อ"><Input name="full_name" required /></FormField>
              <FormField label="อีเมลสำหรับเข้าระบบ"><Input name="email" type="email" autoComplete="off" required /></FormField>
              <FormField label="สิทธิ์" hint={ROLE_HINTS[role]}>
                <Select name="role" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                  {(Object.keys(ROLE_LABELS) as UserRole[])
                    .filter(r => canGrantAdmin || r !== 'admin')
                    .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </FormField>
              <p className="text-xs text-muted-foreground">ระบบสร้างรหัสผ่านชั่วคราวให้ ไม่ต้องยืนยันอีเมล</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
                <Button type="submit" disabled={pending}>{pending ? 'กำลังสร้างบัญชี' : 'สร้างบัญชี'}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function UserRowActions({
  id,
  role,
  isActive,
  isSelf,
  canGrantAdmin,
}: {
  id: string
  role: UserRole
  isActive: boolean
  isSelf: boolean
  canGrantAdmin: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const locked = isSelf || (role === 'admin' && !canGrantAdmin)

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true)
    setError(null)
    const res = await fn()
    setPending(false)
    if (!res.ok) setError(res.error ?? 'เกิดข้อผิดพลาด')
    else router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={role}
          disabled={locked || pending}
          onChange={e => run(() => updateUserAccount(id, { role: e.target.value as UserRole }))}
          className="h-9 w-auto"
          aria-label="สิทธิ์"
        >
          {(Object.keys(ROLE_LABELS) as UserRole[])
            .filter(r => canGrantAdmin || r !== 'admin' || r === role)
            .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
        {!locked && (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updateUserAccount(id, { is_active: !isActive }))}>
              {isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (!confirm('ตั้งรหัสผ่านชั่วคราวใหม่ให้ผู้ใช้นี้ใช่หรือไม่ รหัสเดิมจะใช้ไม่ได้')) return
                setPending(true)
                setError(null)
                const res = await resetUserPassword(id)
                setPending(false)
                if (!res.ok) setError(res.error)
                else setPassword(res.data.password)
              }}
            >
              ตั้งรหัสผ่านใหม่
            </Button>
          </>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {password && <PasswordNotice password={password} />}
    </div>
  )
}
