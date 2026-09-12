'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice, recordPayment, approveInvoice } from '@/actions/finance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from './common'
import { formatBaht } from '@/lib/format'
import { todayISO } from '@/lib/date'

interface PoOption {
  id: string
  po_no: string
  total_amount: number
  supplier_id: string | null
  project_name: string
}

export function InvoiceDialog({ pos, suppliers }: { pos: PoOption[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [poId, setPoId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const po = pos.find(p => p.id === poId)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createInvoice(new FormData(e.currentTarget))
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
      <Button onClick={() => setOpen(true)}>บันทึกใบแจ้งหนี้</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>บันทึกใบแจ้งหนี้</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label="ใบสั่งซื้อ">
              <Select name="po_id" value={poId} onChange={e => setPoId(e.target.value)} required>
                <option value="" disabled>เลือกใบสั่งซื้อ</option>
                {pos.map(p => <option key={p.id} value={p.id}>{p.po_no} · {p.project_name} · {formatBaht(p.total_amount)}</option>)}
              </Select>
            </FormField>
            <FormField label="ซัพพลายเออร์">
              <Select name="supplier_id" key={po?.supplier_id ?? 'none'} defaultValue={po?.supplier_id ?? ''}>
                <option value="">ตาม PO</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="เลขที่ใบแจ้งหนี้"><Input name="invoice_no" required /></FormField>
              <FormField label="จำนวนเงิน (บาท)"><Input name="amount" type="number" step="0.01" min="0" inputMode="decimal" required defaultValue={po?.total_amount ?? ''} key={po?.id ?? 'amt'} /></FormField>
              <FormField label="วันที่ใบแจ้งหนี้"><Input name="invoice_date" type="date" defaultValue={todayISO()} required /></FormField>
              <FormField label="ครบกำหนดชำระ"><Input name="due_date" type="date" /></FormField>
            </div>
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

export function PaymentDialog({ invoiceId, invoiceNo, remaining }: { invoiceId: string; invoiceNo: string; remaining: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await recordPayment(new FormData(e.currentTarget))
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>ชำระเงิน</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>บันทึกการชำระเงิน {invoiceNo}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="จำนวนเงิน (บาท)" hint={`คงเหลือ ${formatBaht(remaining)}`}>
                <Input name="amount" type="number" step="0.01" min="0" inputMode="decimal" required defaultValue={remaining > 0 ? remaining.toFixed(2) : ''} />
              </FormField>
              <FormField label="วันที่ชำระ"><Input name="paid_at" type="date" defaultValue={todayISO()} required /></FormField>
              <FormField label="วิธีชำระ">
                <Select name="method" defaultValue="transfer">
                  <option value="transfer">โอนเงิน</option>
                  <option value="cheque">เช็ค</option>
                  <option value="cash">เงินสด</option>
                </Select>
              </FormField>
              <FormField label="เลขที่อ้างอิง"><Input name="reference_no" /></FormField>
            </div>
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

export function ApproveInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function go() {
    setPending(true)
    const res = await approveInvoice(invoiceId)
    setPending(false)
    if (!res.ok) alert(res.error)
    else router.refresh()
  }
  return <Button size="sm" variant="ghost" onClick={go} disabled={pending}>อนุมัติจ่าย</Button>
}
