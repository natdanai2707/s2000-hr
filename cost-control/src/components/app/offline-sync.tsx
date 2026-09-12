'use client'

import { useEffect, useState } from 'react'
import { useOnline } from '@/lib/hooks/use-online'
import { useRouter } from 'next/navigation'
import { flushQueue, listQueue, subscribeQueue, type QueuedItem } from '@/lib/offline/queue'
import { submitQueuedPurchaseRequest, type QueuedPrPayload } from '@/actions/purchase-requests'

// ส่งฟอร์มที่ค้างใน IndexedDB อัตโนมัติเมื่อกลับมาออนไลน์ และแสดงจำนวน "รอส่ง"
export function OfflineSync() {
  const router = useRouter()
  const [pending, setPending] = useState(0)
  const online = useOnline()

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const items = await listQueue()
        if (mounted) setPending(items.length)
      } catch {
        // IndexedDB ไม่พร้อม (เช่น private mode) ข้ามไป
      }
    }
    const flush = async () => {
      const sent = await flushQueue({
        purchase_request: async (item: QueuedItem) => submitQueuedPurchaseRequest(item.payload as QueuedPrPayload),
      })
      await refresh()
      if (sent > 0) router.refresh()
    }
    const goOnline = () => {
      void flush()
    }
    window.addEventListener('online', goOnline)
    const unsub = subscribeQueue(() => void refresh())
    void refresh()
    if (navigator.onLine) void flush()
    const timer = setInterval(() => {
      if (navigator.onLine) void flush()
    }, 60000)
    return () => {
      mounted = false
      window.removeEventListener('online', goOnline)
      unsub()
      clearInterval(timer)
    }
  }, [router])

  if (online && pending === 0) return null
  return (
    <div className="fixed top-12 md:top-0 inset-x-0 md:left-60 z-40 bg-warning-bg text-warning-fg text-xs px-4 py-1.5 text-center no-print">
      {!online ? 'ออฟไลน์ ' : ''}
      {pending > 0 ? `มีรายการรอส่ง ${pending} รายการ` : 'ฟอร์มที่ส่งจะถูกเก็บไว้และส่งอัตโนมัติเมื่อกลับมาออนไลน์'}
    </div>
  )
}
