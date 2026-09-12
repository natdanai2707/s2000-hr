'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmGoodsReceipt } from '@/actions/receiving'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { formatBaht, formatQty } from '@/lib/format'

interface Item {
  po_item_id: string
  boq_item_id: string
  label: string
  qty: number
  unit: string | null
  unit_price: number
  received: number
}

export function ReceiveForm({ poId, items }: { poId: string; items: Item[] }) {
  const router = useRouter()
  const [qtys, setQtys] = useState<Record<string, string>>(Object.fromEntries(items.map(i => [i.po_item_id, String(Math.max(i.qty - i.received, 0))])))
  const [costs, setCosts] = useState<Record<string, string>>(Object.fromEntries(items.map(i => [i.po_item_id, String(i.unit_price)])))
  const [source, setSource] = useState<'supplier' | 'internal_stock'>('supplier')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const lines = items.map(i => ({ po_item_id: i.po_item_id, boq_item_id: i.boq_item_id, qty_received: Number(qtys[i.po_item_id]) || 0, unit_cost: Number(costs[i.po_item_id]) || 0 }))
    const res = await confirmGoodsReceipt(poId, fd, lines)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/po/${poId}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="rounded-xl border border-border bg-card p-4">
        <FormField label="แหล่งที่มา" hint={source === 'internal_stock' ? 'เหล็กจากสต็อกภายใน ให้ระบุราคาทุน ไม่ใช่ราคาขาย' : undefined}>
          <Select name="source" value={source} onChange={e => setSource(e.target.value as 'supplier' | 'internal_stock')}>
            <option value="supplier">ซัพพลายเออร์</option>
            <option value="internal_stock">สต็อกภายใน (เหล็กใต้)</option>
          </Select>
        </FormField>
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {items.map(i => {
          const remain = Math.max(i.qty - i.received, 0)
          return (
            <div key={i.po_item_id} className="p-4 space-y-2">
              <div className="text-sm font-medium">{i.label}</div>
              <div className="text-xs text-muted-foreground">สั่ง {formatQty(i.qty)} · รับแล้ว {formatQty(i.received)} · คงเหลือ {formatQty(remain)} {i.unit ?? ''}</div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="ปริมาณที่รับจริง">
                  <Input type="number" step="0.001" min="0" inputMode="decimal" value={qtys[i.po_item_id]} onChange={e => setQtys(v => ({ ...v, [i.po_item_id]: e.target.value }))} />
                </FormField>
                <FormField label={source === 'internal_stock' ? 'ราคาทุนต่อหน่วย' : 'ราคาต่อหน่วย'}>
                  <Input type="number" step="0.01" min="0" inputMode="decimal" value={costs[i.po_item_id]} onChange={e => setCosts(v => ({ ...v, [i.po_item_id]: e.target.value }))} />
                </FormField>
              </div>
              <div className="text-right text-xs text-muted-foreground tabular">รวม {formatBaht((Number(qtys[i.po_item_id]) || 0) * (Number(costs[i.po_item_id]) || 0))}</div>
            </div>
          )
        })}
      </div>
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FormField label="รูปถ่าย / เอกสารแนบ">
          <Input type="file" name="attachment" accept="image/*,.pdf" capture="environment" />
        </FormField>
        <FormField label="หมายเหตุ">
          <Textarea name="note" />
        </FormField>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? 'กำลังบันทึก' : 'ยืนยันรับของ'}</Button>
    </form>
  )
}
