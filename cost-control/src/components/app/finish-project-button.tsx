'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveCompletion } from '@/actions/projects'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { DateInput } from './date-input'
import { formatBaht } from '@/lib/format'
import { todayISO } from '@/lib/date'
import type { CloseoutWarning } from '@/lib/closeout'
import type { ProjectStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

// แจ้งงานเสร็จได้ทุกเมื่อ แม้ยังไม่ส่งงาน ยังไม่วางบิล หรือยังไม่รับเงิน ระบบเตือนเรื่องที่ค้างไว้ให้ตามต่อ
// งานที่เสร็จแล้วเปิดกล่องเดิมเพื่อบันทึกการส่งงานภายหลัง หรือปิดโครงการเมื่อเก็บเงินครบ
export function FinishProjectButton({
  projectId,
  status,
  actualEndDate,
  handoverDate,
  warnings,
  contract,
  actualCost,
  variant = 'outline',
}: {
  projectId: string
  status: ProjectStatus
  actualEndDate: string | null
  handoverDate: string | null
  warnings: CloseoutWarning[]
  contract: number
  actualCost: number
  variant?: 'outline' | 'default'
}) {
  const router = useRouter()
  const finished = status === 'closing' || status === 'closed'
  const [open, setOpen] = useState(false)
  const [endDate, setEndDate] = useState(actualEndDate ?? todayISO())
  const [handedOver, setHandedOver] = useState(!!handoverDate)
  const [handover, setHandover] = useState(handoverDate ?? todayISO())
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const profit = contract - actualCost
  // ติ๊กส่งงานในกล่องนี้แล้ว ไม่ต้องเตือนเรื่องส่งงานซ้ำ
  const live = warnings.filter(w => !(w.key === 'handover' && handedOver))
  const moneyLeft = live.some(w => w.target === 'billing')

  async function save(next: 'closing' | 'closed') {
    if (next === 'closed' && live.length > 0 && !confirm('ยังมีเรื่องค้างตามรายการเตือน ปิดโครงการเลยใช่หรือไม่')) return
    setPending(true)
    setError(null)
    const res = await saveCompletion(projectId, { status: next, actualEndDate: endDate, handoverDate: handedOver ? handover : null })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  const label = !finished ? 'แจ้งงานเสร็จ' : status === 'closed' ? 'ข้อมูลจบงาน' : handoverDate ? 'ปิดโครงการ' : 'บันทึกส่งงาน / ปิดโครงการ'

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{finished ? 'งานที่เสร็จแล้ว' : 'แจ้งงานเสร็จ'}</DialogTitle>
            <DialogDescription>
              {finished
                ? 'บันทึกการส่งงานได้ภายหลัง วางบิลและรับเงินต่อได้ที่เมนูวางบิล ปิดโครงการเมื่อเก็บเงินครบ'
                : 'แจ้งได้แม้ยังไม่ส่งงานหรือยังไม่วางบิล โครงการจะย้ายไปกลุ่มงานเสร็จแล้ว วางบิลและรับเงินต่อได้ตามปกติ'}
            </DialogDescription>
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
            </dl>

            <FormField label="วันที่งานเสร็จ (หน้างาน)">
              <DateInput value={endDate} onChange={setEndDate} required />
            </FormField>

            <div className="space-y-2">
              <label className="flex min-h-12 items-center gap-3 rounded border border-input px-3 py-2">
                <input type="checkbox" className="size-5 accent-primary" checked={handedOver} onChange={e => setHandedOver(e.target.checked)} />
                <span className="font-medium">ส่งงานให้ลูกค้าแล้ว</span>
              </label>
              {handedOver && (
                <FormField label="วันที่ส่งงาน">
                  <DateInput value={handover} onChange={setHandover} required />
                </FormField>
              )}
            </div>

            {live.length > 0 ? (
              <Alert tone="warning">
                <div className="font-semibold">ยังค้าง {live.length} เรื่อง</div>
                <ul className="mt-1 list-disc pl-5">
                  {live.map(w => <li key={w.key}>{w.label}</li>)}
                </ul>
              </Alert>
            ) : (
              <Alert tone="success">ส่งงาน วางบิล และรับเงินครบแล้ว ปิดโครงการได้</Alert>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
              {status === 'closed' ? (
                <>
                  <Button variant="outline" onClick={() => save('closing')} disabled={pending}>เปิดกลับเป็นงานเสร็จแล้ว</Button>
                  <Button onClick={() => save('closed')} disabled={pending}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
                </>
              ) : (
                <>
                  {finished && (
                    <Button variant={moneyLeft ? 'outline' : 'default'} onClick={() => save('closed')} disabled={pending}>ปิดโครงการ</Button>
                  )}
                  <Button variant={finished && !moneyLeft ? 'outline' : 'default'} onClick={() => save('closing')} disabled={pending}>
                    {pending ? 'กำลังบันทึก' : finished ? 'บันทึก' : 'แจ้งงานเสร็จ'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
