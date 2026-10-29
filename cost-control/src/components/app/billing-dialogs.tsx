'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBilling, updateBilling, voidBilling, recordReceipt, updateReceipt, deleteReceipt } from '@/actions/billing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from './common'
import { DateInput } from './date-input'
import { VatPriceInput } from './vat-price-input'
import { formatBaht, formatPct } from '@/lib/format'
import { todayISO } from '@/lib/date'
import { VAT_RATE_PCT } from '@/lib/vat'

export interface BillingProject {
  id: string
  code: string
  name: string
  contract_value: number
  retention_pct: number
}

export interface BillingRow {
  id: string
  project_id: string
  billing_no: string
  installment: string | null
  billed_date: string
  due_date: string | null
  amount: number
  vat_amount: number
  note: string | null
  outstanding: number
}

export interface ReceiptRow {
  id: string
  received_date: string
  amount_received: number
  withholding_tax: number
  retention: number
  other_deduction: number
  is_retention_release: boolean
  note: string | null
}

// หัก ณ ที่จ่ายค่าจ้างทำของหรือรับเหมา ลูกค้าส่วนใหญ่หัก 3% ของยอดก่อน VAT แก้ได้ทุกครั้ง
const WHT_PCT = 3

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (t: string) => {
  const n = Number(t.replace(/,/g, ''))
  return t.trim() === '' || isNaN(n) ? 0 : n
}

function useSubmit(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, onDone: () => void) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await action(new FormData(e.currentTarget))
    setPending(false)
    if (!res.ok) {
      setError(res.error ?? 'เกิดข้อผิดพลาด')
      return
    }
    onDone()
    router.refresh()
  }
  return { error, pending, onSubmit, setError }
}

// วางบิลใหม่ หรือแก้ไขบิลเดิม (billing)
export function BillingDialog({ projects, billing, defaultProjectId }: { projects: BillingProject[]; billing?: BillingRow; defaultProjectId?: string }) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(billing?.project_id ?? defaultProjectId ?? (projects.length === 1 ? projects[0].id : ''))
  const [amount, setAmount] = useState(billing ? String(billing.amount) : '')
  const [noVat, setNoVat] = useState(billing ? billing.vat_amount === 0 : false)
  const project = projects.find(p => p.id === projectId)
  const vat = noVat ? 0 : r2((num(amount) * VAT_RATE_PCT) / 100)
  const { error, pending, onSubmit } = useSubmit(fd => (billing ? updateBilling(billing.id, fd) : createBilling(fd)), () => setOpen(false))

  return (
    <>
      <Button size={billing ? 'sm' : 'default'} variant={billing ? 'ghost' : 'default'} onClick={() => setOpen(true)}>
        {billing ? 'แก้ไข' : 'บันทึกการวางบิล'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{billing ? `แก้ไขใบวางบิล ${billing.billing_no}` : 'บันทึกการวางบิล'}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label="โครงการ">
              <Select name="project_id" value={projectId} onChange={e => setProjectId(e.target.value)} required disabled={!!billing}>
                <option value="" disabled>เลือกโครงการ</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
              </Select>
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="เลขที่ใบวางบิล" hint={billing ? undefined : 'เว้นว่างให้ระบบออกเลข'}>
                <Input name="billing_no" defaultValue={billing?.billing_no ?? ''} />
              </FormField>
              <FormField label="งวด / รายละเอียด">
                <Input name="installment" defaultValue={billing?.installment ?? ''} placeholder="เช่น งวดที่ 2 ติดตั้งหลังคา 40%" />
              </FormField>
              <FormField label="วันที่วางบิล"><DateInput name="billed_date" defaultValue={billing?.billed_date ?? todayISO()} required /></FormField>
              <FormField label="ครบกำหนดชำระ"><DateInput name="due_date" defaultValue={billing?.due_date ?? undefined} /></FormField>
            </div>
            <VatPriceInput label="ยอดวางบิล" value={amount} onChange={setAmount} required />
            <input type="hidden" name="amount" value={amount} />
            <input type="hidden" name="vat_amount" value={vat} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4" checked={noVat} onChange={e => setNoVat(e.target.checked)} />
              ไม่คิด VAT
            </label>
            {num(amount) > 0 && (
              <p className="text-sm text-muted-foreground tabular">
                VAT {formatBaht(vat)} · รวม {formatBaht(num(amount) + vat)} บาท
                {project && project.contract_value > 0 && ` · งวดนี้ ${formatPct((num(amount) / project.contract_value) * 100)} ของมูลค่าสัญญา`}
              </p>
            )}
            <FormField label="หมายเหตุ"><Textarea name="note" defaultValue={billing?.note ?? ''} /></FormField>
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

// รับเงิน: ผูกกับบิล (billing) หรือเงินเข้าที่ไม่ผูกบิล เช่น คืนเงินประกันผลงาน (เลือกโครงการเอง)
// แก้ไขรายการเดิมเมื่อส่ง receipt มา
export function ReceiptDialog({
  billing,
  projects,
  receipt,
  retentionPct = 0,
}: {
  billing?: BillingRow
  projects?: BillingProject[]
  receipt?: ReceiptRow
  retentionPct?: number
}) {
  const [open, setOpen] = useState(false)
  const firstPayment = billing && !receipt && billing.outstanding >= r2(billing.amount + billing.vat_amount)
  // รับครั้งแรกเต็มบิล เสนอหัก ณ ที่จ่ายและเงินประกันผลงานตามปกติ ไม่งั้นเสนอเงินเข้าเท่ายอดค้าง
  const suggestWht = firstPayment ? r2((billing.amount * WHT_PCT) / 100) : 0
  const suggestRet = firstPayment ? r2((billing.amount * retentionPct) / 100) : 0
  const [cash, setCash] = useState(receipt ? String(receipt.amount_received) : billing ? String(r2(billing.outstanding - suggestWht - suggestRet)) : '')
  const [wht, setWht] = useState(receipt ? String(receipt.withholding_tax) : suggestWht ? String(suggestWht) : '')
  const [ret, setRet] = useState(receipt ? String(receipt.retention) : suggestRet ? String(suggestRet) : '')
  const [other, setOther] = useState(receipt ? String(receipt.other_deduction) : '')
  const [release, setRelease] = useState(receipt?.is_retention_release ?? false)
  const [projectId, setProjectId] = useState('')
  const settled = num(cash) + (release ? 0 : num(wht) + num(ret) + num(other))
  const { error, pending, onSubmit } = useSubmit(fd => (receipt ? updateReceipt(receipt.id, fd) : recordReceipt(fd)), () => setOpen(false))
  const linked = !!billing

  return (
    <>
      <Button size="sm" variant={receipt ? 'ghost' : linked ? 'outline' : 'outline'} onClick={() => setOpen(true)}>
        {receipt ? 'แก้ไข' : linked ? 'รับเงิน' : 'บันทึกเงินเข้าอื่น'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{receipt ? 'แก้ไขรายการรับเงิน' : linked ? `รับเงิน ${billing!.billing_no}` : 'บันทึกเงินเข้าที่ไม่ผูกบิล'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            {billing && <input type="hidden" name="billing_id" value={billing.id} />}
            {!linked && !receipt && (
              <FormField label="โครงการ">
                <Select name="project_id" value={projectId} onChange={e => setProjectId(e.target.value)} required>
                  <option value="" disabled>เลือกโครงการ</option>
                  {(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                </Select>
              </FormField>
            )}
            {!linked && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4" checked={release} onChange={e => setRelease(e.target.checked)} />
                ลูกค้าคืนเงินประกันผลงาน
                <input type="hidden" name="is_retention_release" value={release ? '1' : '0'} />
              </label>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="วันที่เงินเข้า"><DateInput name="received_date" defaultValue={receipt?.received_date ?? todayISO()} required /></FormField>
              <FormField label="เงินเข้าบัญชีจริง">
                <Input name="amount_received" type="number" step="0.01" min="0" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} />
              </FormField>
              {!release && (
                <>
                  <FormField label="ภาษีหัก ณ ที่จ่าย" hint={billing ? `${WHT_PCT}% ของยอดก่อน VAT = ${formatBaht((billing.amount * WHT_PCT) / 100)}` : undefined}>
                    <Input name="withholding_tax" type="number" step="0.01" min="0" inputMode="decimal" value={wht} onChange={e => setWht(e.target.value)} />
                  </FormField>
                  <FormField label="เงินประกันผลงานที่ลูกค้าหัก" hint={billing && retentionPct > 0 ? `ตามสัญญา ${retentionPct}% = ${formatBaht((billing.amount * retentionPct) / 100)}` : undefined}>
                    <Input name="retention" type="number" step="0.01" min="0" inputMode="decimal" value={ret} onChange={e => setRet(e.target.value)} />
                  </FormField>
                  <FormField label="หักอื่นๆ" hint="เช่น ค่าปรับ ค่าธรรมเนียมโอน">
                    <Input name="other_deduction" type="number" step="0.01" min="0" inputMode="decimal" value={other} onChange={e => setOther(e.target.value)} />
                  </FormField>
                </>
              )}
            </div>
            {billing && (
              <p className={settled > billing.outstanding + 0.005 && !receipt ? 'text-sm text-danger-fg tabular' : 'text-sm text-muted-foreground tabular'}>
                ตัดยอดบิล {formatBaht(settled)} จากยอดค้าง {formatBaht(billing.outstanding)}
                {!receipt && ` · เหลือค้าง ${formatBaht(Math.max(billing.outstanding - settled, 0))}`}
                {!receipt && settled > billing.outstanding + 0.005 && ' เกินยอดค้าง ตรวจตัวเลข'}
              </p>
            )}
            <FormField label="หมายเหตุ"><Textarea name="note" defaultValue={receipt?.note ?? ''} placeholder="เช่น โอนเข้าบัญชีกสิกร เลขที่ใบรับเงิน" /></FormField>
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

export function VoidBillingButton({ id, billingNo }: { id: string; billingNo: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const { error, pending, onSubmit, setError } = useSubmit(() => voidBilling(id, reason), () => setOpen(false))
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setError(null); setOpen(true) }}>ยกเลิกบิล</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>ยกเลิกใบวางบิล {billingNo}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <p className="text-sm">บิลที่ยกเลิกไม่นับในยอดวางบิลและยอดค้างรับ ประวัติยังเก็บไว้</p>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผล เช่น ออกบิลผิดงวด" required />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ไม่ยกเลิก</Button>
              <Button type="submit" variant="destructive" disabled={pending}>{pending ? 'กำลังยกเลิก' : 'ยืนยันยกเลิก'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DeleteReceiptButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function onClick() {
    if (!confirm('ลบรายการรับเงินนี้ใช่หรือไม่')) return
    setPending(true)
    const res = await deleteReceipt(id)
    setPending(false)
    if (!res.ok) alert(res.error)
    else router.refresh()
  }
  return <Button size="sm" variant="ghost" onClick={onClick} disabled={pending}>ลบ</Button>
}
