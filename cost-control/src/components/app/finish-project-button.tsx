'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { finishProject } from '@/actions/projects'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { DateInput } from './date-input'
import { formatBaht } from '@/lib/format'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

// จบงาน: สรุปตัวเลขสุดท้ายให้ดูก่อน แล้วเลือกว่ายังมีเงินรอเก็บ (กำลังปิด) หรือปิดโครงการเลย
export function FinishProjectButton({
  projectId,
  contract,
  actualCost,
  outstanding,
  retentionHeld,
}: {
  projectId: string
  contract: number
  actualCost: number
  outstanding: number
  retentionHeld: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayISO())
  const moneyLeft = outstanding > 0.005 || retentionHeld > 0.005
  const [status, setStatus] = useState<'closing' | 'closed'>(moneyLeft ? 'closing' : 'closed')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const profit = contract - actualCost

  async function save() {
    setPending(true)
    setError(null)
    const res = await finishProject(projectId, status, date)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  const choice = (value: 'closing' | 'closed', title: string, detail: string) => (
    <button
      type="button"
      onClick={() => setStatus(value)}
      aria-pressed={status === value}
      className={cn('w-full rounded border px-3 py-3 text-left', status === value ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-muted')}
    >
      <div className="font-semibold">{title}</div>
      <div className={cn('text-xs mt-0.5', status === value ? 'text-white/85' : 'text-muted-foreground')}>{detail}</div>
    </button>
  )

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>จบงาน</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>จบงาน</DialogTitle>
            <DialogDescription>บันทึกวันที่งานเสร็จจริง ตัวเลขด้านล่างเป็นยอด ณ วันนี้ ไม่รวม VAT</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">มูลค่าสัญญา</dt>
              <dd className="text-right tabular font-semibold">{formatBaht(contract)}</dd>
              <dt className="text-muted-foreground">ต้นทุนจริง</dt>
              <dd className="text-right tabular font-semibold">{formatBaht(actualCost)}</dd>
              <dt className="text-muted-foreground">กำไรตามต้นทุนจริง</dt>
              <dd className={cn('text-right tabular font-semibold', profit < 0 ? 'text-danger-fg' : 'text-success-fg')}>{formatBaht(profit)}</dd>
              <dt className="text-muted-foreground">ค้างรับจากลูกค้า (รวม VAT)</dt>
              <dd className={cn('text-right tabular font-semibold', outstanding > 0.005 && 'text-warning-fg')}>{formatBaht(outstanding)}</dd>
              <dt className="text-muted-foreground">เงินประกันที่ลูกค้าถือไว้</dt>
              <dd className={cn('text-right tabular font-semibold', retentionHeld > 0.005 && 'text-warning-fg')}>{formatBaht(retentionHeld)}</dd>
            </dl>
            <FormField label="วันที่งานเสร็จจริง">
              <DateInput value={date} onChange={setDate} required />
            </FormField>
            <div className="space-y-2">
              {choice('closing', 'งานเสร็จ รอเก็บเงิน', 'ยังวางบิลและรับเงินได้ ยังอยู่ในภาพรวม เหมาะเมื่อยังมีค้างรับหรือเงินประกันผลงาน')}
              {choice('closed', 'ปิดโครงการ', 'เก็บเงินครบแล้ว โครงการย้ายออกจากภาพรวม ยังเปิดดูได้ที่หน้าโครงการ')}
            </div>
            {status === 'closed' && moneyLeft && (
              <Alert tone="warning">ยังมีเงินค้างรับหรือเงินประกันผลงาน ปิดได้ แต่ถ้ายังต้องตามเก็บ แนะนำเลือก งานเสร็จ รอเก็บเงิน ก่อน</Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
              <Button onClick={save} disabled={pending}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
