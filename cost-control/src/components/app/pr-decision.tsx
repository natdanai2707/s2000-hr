'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { decidePurchaseRequest, cancelPurchaseRequest } from '@/actions/purchase-requests'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'

// ปุ่มอนุมัติ/ปฏิเสธขนาดใหญ่สำหรับมือถือ ปฏิเสธต้องใส่เหตุผล
export function PrDecision({ prId, canDecide, canCancel }: { prId: string; canDecide: boolean; canCancel: boolean }) {
  const router = useRouter()
  const [comment, setComment] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function decide(decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !comment.trim()) {
      setRejecting(true)
      setError('กรุณาระบุเหตุผลในการปฏิเสธ')
      return
    }
    setPending(true)
    setError(null)
    const res = await decidePurchaseRequest(prId, decision, comment.trim())
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  async function cancel() {
    if (!confirm('ยกเลิกใบขอซื้อนี้ใช่หรือไม่')) return
    setPending(true)
    const res = await cancelPurchaseRequest(prId)
    setPending(false)
    if (!res.ok) setError(res.error)
    else router.refresh()
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 sticky bottom-20 md:static">
      {error && <Alert tone="danger">{error}</Alert>}
      {canDecide && (
        <>
          <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={rejecting ? 'เหตุผลในการปฏิเสธ (บังคับ)' : 'ความเห็น (ไม่บังคับ ยกเว้นกรณีปฏิเสธ)'} />
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="destructive" onClick={() => decide('rejected')} disabled={pending}>ปฏิเสธ</Button>
            <Button size="lg" variant="success" onClick={() => decide('approved')} disabled={pending}>อนุมัติ</Button>
          </div>
        </>
      )}
      {canCancel && (
        <Button variant="ghost" className="w-full" onClick={cancel} disabled={pending}>ยกเลิกใบขอซื้อ</Button>
      )}
    </div>
  )
}
