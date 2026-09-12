'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelPurchaseOrder } from '@/actions/purchase-orders'
import { Button } from '@/components/ui/button'

export function PoCancelButton({ poId }: { poId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function cancel() {
    if (!confirm('ยกเลิกใบสั่งซื้อนี้ใช่หรือไม่')) return
    setPending(true)
    const res = await cancelPurchaseOrder(poId)
    setPending(false)
    if (!res.ok) alert(res.error)
    else router.refresh()
  }
  return <Button variant="outline" onClick={cancel} disabled={pending}>ยกเลิก PO</Button>
}
