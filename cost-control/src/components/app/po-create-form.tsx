'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPoFromPr } from '@/actions/purchase-orders'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { VatPriceInput } from './vat-price-input'
import { addVat } from '@/lib/vat'
import { formatBaht, formatQty } from '@/lib/format'

interface Item {
  id: string
  description: string
  qty: number
  unit: string | null
  unit_price: number
  supplier_name: string | null
}

export function PoCreateForm({ prId, items, suppliers, defaultSupplierId, thresholdPct }: { prId: string; items: Item[]; suppliers: { id: string; name: string }[]; defaultSupplierId: string; thresholdPct: number }) {
  const router = useRouter()
  const [supplierId, setSupplierId] = useState(defaultSupplierId)
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(items.map(i => [i.id, String(i.unit_price)])))
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const overThreshold = items.filter(i => Number(prices[i.id]) > i.unit_price * (1 + thresholdPct / 100))
  const total = items.reduce((s, i) => s + i.qty * (Number(prices[i.id]) || 0), 0)

  async function submit() {
    setPending(true)
    setError(null)
    const res = await createPoFromPr(
      prId,
      supplierId || null,
      items.filter(i => Number(prices[i.id]) !== i.unit_price).map(i => ({ pr_item_id: i.id, unit_price: Number(prices[i.id]) }))
    )
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (!res.data.po_id) {
      setInfo('ราคาที่แก้แพงขึ้นเกินเกณฑ์ ระบบส่งใบขอซื้อกลับไปอนุมัติใหม่แล้ว ยังไม่ออก PO')
      setTimeout(() => router.push(`/pr/${prId}`), 1500)
      return
    }
    router.push(`/po/${res.data.po_id}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="warning">{info}</Alert>}
      <div className="rounded-xl border border-border bg-card p-4">
        <FormField label="ซัพพลายเออร์" hint={items[0]?.supplier_name ? `ผู้ขอระบุ: ${items.map(i => i.supplier_name).filter(Boolean).join(', ')}` : undefined}>
          <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">ไม่ระบุ</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {items.map(i => {
          const p = Number(prices[i.id]) || 0
          const over = p > i.unit_price * (1 + thresholdPct / 100)
          return (
            <div key={i.id} className="p-4 space-y-2">
              <div className="text-sm font-medium">{i.description}</div>
              <div className="text-xs text-muted-foreground">{formatQty(i.qty)} {i.unit ?? ''} · ราคาตาม PR {formatBaht(i.unit_price)} (ไม่รวม VAT)</div>
              <VatPriceInput label="ราคาต่อหน่วยใน PO" value={prices[i.id]} onChange={v => setPrices(prev => ({ ...prev, [i.id]: v }))} invalid={over} />
              <div className="text-right text-sm tabular">รวม {formatBaht(i.qty * p)} (ไม่รวม VAT)</div>
              {over && <p className="text-xs text-danger-fg">แพงขึ้นเกิน {thresholdPct}% ต้องกลับไปอนุมัติใหม่</p>}
            </div>
          )
        })}
        <div className="p-4 flex justify-between font-semibold text-sm">
          <span>มูลค่ารวม</span>
          <span className="tabular text-right">
            {formatBaht(total)} บาท (ไม่รวม VAT)
            <span className="block text-xs font-normal text-muted-foreground">{formatBaht(addVat(total))} บาท (รวม VAT)</span>
          </span>
        </div>
      </div>
      {overThreshold.length > 0 && <Alert tone="warning">มี {overThreshold.length} รายการที่ราคาแพงขึ้นเกินเกณฑ์ เมื่อกดบันทึก ระบบจะปรับราคาใน PR และส่งกลับไปอนุมัติใหม่แทนการออก PO</Alert>}
      <Button size="lg" className="w-full" onClick={submit} disabled={pending}>
        {pending ? 'กำลังบันทึก' : overThreshold.length > 0 ? 'ส่งกลับไปอนุมัติใหม่' : 'ออกใบสั่งซื้อ'}
      </Button>
    </div>
  )
}
