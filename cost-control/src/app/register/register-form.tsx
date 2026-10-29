'use client'

import { useState } from 'react'
import Link from 'next/link'
import { registerAccount } from '@/actions/register'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'

// สมัครแล้วยังเข้าใช้งานไม่ได้จนกว่าฝ่ายบริหารเลือกสิทธิ์และเปิดบัญชีให้
export function RegisterForm() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (fd.get('password') !== fd.get('confirm')) {
      setError('รหัสผ่านสองช่องไม่ตรงกัน')
      return
    }
    setPending(true)
    setError(null)
    const res = await registerAccount(fd)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <Card>
        <CardContent className="pt-5 space-y-4">
          <Alert tone="success">ส่งคำขอสมัครแล้ว ฝ่ายบริหารจะเลือกสิทธิ์และเปิดบัญชีให้ แล้วเข้าระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้</Alert>
          <Button asChild className="w-full"><Link href="/login">ไปหน้าเข้าสู่ระบบ</Link></Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="full_name">ชื่อ นามสกุล</Label>
            <Input id="full_name" name="full_name" autoComplete="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน (อย่างน้อย 8 ตัว)</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">ยืนยันรหัสผ่าน</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">ตำแหน่งหรือหน้าที่</Label>
            <Input id="note" name="note" placeholder="เช่น บัญชี สาขาบ้านพรุ" />
          </div>
          {/* ช่องกันบอท คนมองไม่เห็น */}
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'กำลังส่งคำขอ' : 'สมัครใช้งาน'}
          </Button>
          <p className="text-xs text-muted-foreground">สมัครแล้วต้องรอฝ่ายบริหารเปิดบัญชีก่อนจึงจะเข้าใช้งานได้</p>
        </form>
      </CardContent>
    </Card>
  )
}
