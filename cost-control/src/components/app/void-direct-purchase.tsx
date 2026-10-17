'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { voidDirectPurchase } from '@/actions/purchase-requests'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'

// ยกเลิกรายการสั่งซื้อที่บันทึกผิด ต้องระบุเหตุผล เพื่อให้ย้อนดูได้ว่าต้นทุนหายไปเพราะอะไร
export function VoidDirectPurchase({ prId }: { prId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit() {
    if (!reason.trim()) {
      setError('กรุณาระบุเหตุผลที่ยกเลิก')
      return
    }
    setPending(true)
    setError(null)
    const res = await voidDirectPurchase(prId, reason.trim())
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  if (!open) {
    return (
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        ยกเลิกรายการสั่งซื้อนี้
      </Button>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-sm">ยกเลิกแล้วต้นทุนของรายการนี้จะถูกหักออกจากโครงการ ถ้าบันทึกผิด ให้ยกเลิกแล้วบันทึกใหม่</p>
      <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผล เช่น กรอกราคาผิด / เลือกรายการ BOQ ผิด" />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>ไม่ยกเลิก</Button>
        <Button variant="destructive" onClick={submit} disabled={pending}>{pending ? 'กำลังยกเลิก' : 'ยืนยันยกเลิก'}</Button>
      </div>
    </div>
  )
}
