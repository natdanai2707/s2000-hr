'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupplier } from '@/actions/purchase-orders'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from './common'

export function SupplierDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createSupplier(new FormData(e.currentTarget))
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>เพิ่มซัพพลายเออร์</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>เพิ่มซัพพลายเออร์</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label="ชื่อ"><Input name="name" required /></FormField>
            <FormField label="เลขผู้เสียภาษี"><Input name="tax_id" /></FormField>
            <FormField label="โทรศัพท์"><Input name="phone" type="tel" /></FormField>
            <FormField label="หมายเหตุ"><Input name="note" /></FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={pending}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
