'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setPurchaseQtyFactor } from '@/actions/purchase-requests'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBaht, formatQty } from '@/lib/format'

// เติมตัวแปลงหน่วยให้บรรทัดที่บันทึกไปแล้ว เช่น ตอนซื้อยังไม่รู้ว่า 1 ชุดเท่ากับกี่ m2
export function QtyFactorEditor({
  prItemId,
  factor,
  qty,
  unitPrice,
  buyUnit,
  boqUnit,
}: {
  prItemId: string
  factor: number | null
  qty: number
  unitPrice: number
  buyUnit: string | null
  boqUnit: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(factor === null ? '' : String(factor))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const f = Number(value)
  const valid = value.trim() === '' || f > 0

  async function save() {
    if (!valid) {
      setError('ตัวแปลงหน่วยต้องมากกว่า 0 หรือเว้นว่างไว้')
      return
    }
    setPending(true)
    setError(null)
    const res = await setPurchaseQtyFactor(prItemId, value.trim() === '' ? null : f)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
        {factor === null ? 'ระบุตัวแปลงหน่วย' : 'แก้ตัวแปลงหน่วย'}
      </Button>
    )
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/50 p-3">
      <label className="block text-sm">
        1 {buyUnit || 'หน่วย'} = กี่ {boqUnit || 'หน่วย BOQ'}
        <Input type="number" step="0.001" min="0" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="ไม่ทราบ เว้นว่างได้" className="mt-1" autoFocus />
      </label>
      {value.trim() !== '' && f > 0 && (
        <p className="text-xs text-muted-foreground tabular">
          = {formatQty(qty * f)} {boqUnit ?? ''} ที่ {formatBaht(unitPrice / f)} บาทต่อ {boqUnit || 'หน่วย'} (ไม่รวม VAT) ยอดเงินเท่าเดิม
        </p>
      )}
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>ยกเลิก</Button>
        <Button size="sm" onClick={save} disabled={pending || !valid}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
      </div>
    </div>
  )
}
