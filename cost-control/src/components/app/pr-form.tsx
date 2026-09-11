'use client'

import { useMemo, useState } from 'react'
import { useOnline } from '@/lib/hooks/use-online'
import { useRouter } from 'next/navigation'
import { submitPurchaseRequest, type PrLinePayload, type QueuedPrPayload } from '@/actions/purchase-requests'
import { evaluateLine, routePurchaseRequest } from '@/lib/pr/routing'
import { enqueue, newClientRef } from '@/lib/offline/queue'
import type { Settings, BoqCategory } from '@/lib/types'
import { BOQ_CATEGORY_LABELS } from '@/lib/types'
import { formatBaht, formatQty, formatPct } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { cn } from '@/lib/utils'

export interface PrFormItem {
  id: string
  item_no: string | null
  description: string
  unit: string | null
  category: BoqCategory
  is_off_boq: boolean
  qty: number
  unit_cost: number
  qty_ordered: number
}
export interface PrFormProject {
  id: string
  code: string
  name: string
  items: PrFormItem[]
}

interface Line {
  key: string
  boq_item_id: string
  search: string
  qty: string
  unit_price: string
  supplier_id: string
  supplier_name: string
  variance_reason: string
}

function newLine(): Line {
  return { key: newClientRef(), boq_item_id: '', search: '', qty: '', unit_price: '', supplier_id: '', supplier_name: '', variance_reason: '' }
}

export function PrForm({ projects, suppliers, settings, initialProjectId }: { projects: PrFormProject[]; suppliers: { id: string; name: string }[]; settings: Settings; initialProjectId: string | null }) {
  const router = useRouter()
  const [projectId, setProjectId] = useState(initialProjectId && projects.some(p => p.id === initialProjectId) ? initialProjectId : projects.length === 1 ? projects[0].id : '')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null)
  const online = useOnline()

  const project = projects.find(p => p.id === projectId)
  const items = useMemo(() => project?.items ?? [], [project])

  const evaluated = lines.map(l => {
    const item = items.find(i => i.id === l.boq_item_id)
    if (!item) return { line: l, item: null, ev: null }
    const ev = evaluateLine(
      { qty: Number(l.qty) || 0, unitPrice: Number(l.unit_price) || 0, boqQty: item.qty, boqUnitCost: item.unit_cost, qtyOrdered: item.qty_ordered, isOffBoq: item.is_off_boq, varianceReason: l.variance_reason },
      settings
    )
    return { line: l, item, ev }
  })
  const routing = routePurchaseRequest(
    evaluated.filter(e => e.item).map(e => ({ qty: Number(e.line.qty) || 0, unitPrice: Number(e.line.unit_price) || 0, boqQty: e.item!.qty, boqUnitCost: e.item!.unit_cost, qtyOrdered: e.item!.qty_ordered, isOffBoq: e.item!.is_off_boq, varianceReason: e.line.variance_reason })),
    settings
  )

  function update(key: string, patch: Partial<Line>) {
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  function buildPayload(): QueuedPrPayload | string {
    if (!projectId) return 'กรุณาเลือกโครงการ'
    const payloadLines: PrLinePayload[] = []
    for (const e of evaluated) {
      if (!e.item) return 'กรุณาเลือกรายการ BOQ ให้ครบทุกบรรทัด'
      const qty = Number(e.line.qty)
      const price = Number(e.line.unit_price)
      if (!(qty > 0)) return 'ปริมาณต้องมากกว่า 0'
      if (!(price >= 0) || e.line.unit_price === '') return 'กรุณากรอกราคาต่อหน่วย'
      if (e.ev!.requiresReason && !e.line.variance_reason.trim()) return 'กรุณาระบุเหตุผลสำหรับรายการที่เกิน BOQ เกินราคาที่ทดไว้ หรือนอก BOQ'
      const sup = suppliers.find(s => s.id === e.line.supplier_id)
      payloadLines.push({
        boq_item_id: e.item.id,
        description: e.item.description,
        qty,
        unit: e.item.unit,
        unit_price: price,
        supplier_id: sup?.id ?? null,
        supplier_name: sup?.name ?? (e.line.supplier_name.trim() || null),
        variance_reason: e.line.variance_reason.trim() || null,
      })
    }
    return { client_ref: newClientRef(), project_id: projectId, needed_by_date: neededBy || null, note: note.trim() || null, lines: payloadLines }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = buildPayload()
    if (typeof payload === 'string') {
      setError(payload)
      return
    }
    setPending(true)
    if (!navigator.onLine) {
      await enqueue('purchase_request', payload, payload.client_ref)
      setPending(false)
      setQueuedMsg('บันทึกไว้ในเครื่องแล้ว สถานะ รอส่ง ระบบจะส่งอัตโนมัติเมื่อกลับมาออนไลน์')
      setLines([newLine()])
      setNote('')
      return
    }
    try {
      const res = await submitPurchaseRequest(payload)
      setPending(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/pr/${res.data.id}`)
      router.refresh()
    } catch {
      // เครือข่ายล้มระหว่างส่ง เก็บเข้า queue (idempotent ด้วย client_ref)
      await enqueue('purchase_request', payload, payload.client_ref)
      setPending(false)
      setQueuedMsg('ส่งไม่สำเร็จ บันทึกไว้ในเครื่องแล้ว สถานะ รอส่ง ระบบจะส่งอัตโนมัติเมื่อกลับมาออนไลน์')
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!online && <Alert tone="warning">ออฟไลน์ ฟอร์มที่ส่งจะถูกเก็บไว้และส่งอัตโนมัติเมื่อกลับมาออนไลน์</Alert>}
      {queuedMsg && <Alert tone="success">{queuedMsg}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FormField label="โครงการ">
          <Select value={projectId} onChange={e => { setProjectId(e.target.value); setLines([newLine()]) }} required>
            <option value="" disabled>เลือกโครงการ</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </Select>
        </FormField>
      </div>

      {evaluated.map(({ line, item, ev }, idx) => {
        const q = line.search.trim().toLowerCase()
        const matches = q && !item ? items.filter(i => `${i.item_no ?? ''} ${i.description} ${i.unit ?? ''}`.toLowerCase().includes(q)).slice(0, 12) : []
        return (
          <div key={line.key} className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">รายการที่ {idx + 1}</div>
              {lines.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setLines(ls => ls.filter(l => l.key !== line.key))}>ลบ</Button>}
            </div>

            <FormField label="รายการ BOQ" hint={!item ? 'พิมพ์ลำดับหรือชื่อรายการเพื่อค้นหา' : undefined}>
              {item ? (
                <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium">{item.item_no ? `${item.item_no} ` : ''}{item.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {BOQ_CATEGORY_LABELS[item.category]} · หน่วย {item.unit ?? '-'} · คงเหลือ {formatQty(item.qty - item.qty_ordered)} {item.unit ?? ''}
                      {item.is_off_boq && ' · รายการนอก BOQ ต้องระบุเหตุผล'}
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => update(line.key, { boq_item_id: '', search: '' })}>เปลี่ยน</Button>
                </div>
              ) : (
                <div>
                  <Input value={line.search} onChange={e => update(line.key, { search: e.target.value })} placeholder="ค้นหา เช่น 1.2 หรือ เหล็ก H-Beam" disabled={!projectId} />
                  {matches.length > 0 && (
                    <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
                      {matches.map(i => (
                        <li key={i.id}>
                          <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => update(line.key, { boq_item_id: i.id, search: '', unit_price: line.unit_price || String(i.unit_cost) })}>
                            <div className="font-medium">{i.item_no ? `${i.item_no} ` : ''}{i.description}</div>
                            <div className="text-xs text-muted-foreground">{BOQ_CATEGORY_LABELS[i.category]} · {i.unit ?? '-'} · คงเหลือ {formatQty(i.qty - i.qty_ordered)}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q && matches.length === 0 && <p className="mt-1 text-xs text-muted-foreground">ไม่พบรายการ ถ้าเป็นของนอก BOQ ให้ค้นหาคำว่า นอก BOQ</p>}
                </div>
              )}
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="ปริมาณ">
                <Input type="number" step="0.001" min="0" inputMode="decimal" value={line.qty} onChange={e => update(line.key, { qty: e.target.value })} required />
              </FormField>
              <FormField label="ราคาต่อหน่วย (บาท)">
                <Input type="number" step="0.01" min="0" inputMode="decimal" value={line.unit_price} onChange={e => update(line.key, { unit_price: e.target.value })} required />
              </FormField>
            </div>

            {item && ev && (line.qty !== '' || line.unit_price !== '') && (
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-2">
                <div className="grid grid-cols-4 gap-1 text-center">
                  <div><div className="text-xs text-muted-foreground">ตาม BOQ</div><div className="tabular">{item.is_off_boq ? '-' : formatQty(item.qty)}</div></div>
                  <div><div className="text-xs text-muted-foreground">สั่งแล้ว</div><div className="tabular">{formatQty(item.qty_ordered)}</div></div>
                  <div><div className="text-xs text-muted-foreground">คงเหลือ</div><div className="tabular">{item.is_off_boq ? '-' : formatQty(ev.qtyRemaining)}</div></div>
                  <div><div className="text-xs text-muted-foreground">ครั้งนี้</div><div className="tabular">{formatQty(Number(line.qty) || 0)}</div></div>
                </div>
                {ev.qtyOverBoq && <div className="text-danger-fg font-medium text-center">เกิน BOQ {formatQty(ev.qtyOverBy)} {item.unit ?? 'หน่วย'}</div>}
                {!item.is_off_boq && (
                  <div className="grid grid-cols-3 gap-1 text-center border-t border-border pt-2">
                    <div><div className="text-xs text-muted-foreground">ราคาทด</div><div className="tabular">{formatBaht(item.unit_cost)}</div></div>
                    <div><div className="text-xs text-muted-foreground">ราคาครั้งนี้</div><div className="tabular">{formatBaht(Number(line.unit_price) || 0)}</div></div>
                    <div>
                      <div className="text-xs text-muted-foreground">ส่วนต่าง</div>
                      <div className={cn('tabular', ev.priceOverThreshold && 'text-danger-fg font-medium', ev.priceBelow && 'text-success-fg font-medium')}>
                        {line.unit_price === '' ? '-' : `${ev.priceDiff >= 0 ? '+' : ''}${formatBaht(ev.priceDiff)} (${ev.priceDiffPct === null ? '-' : formatPct(ev.priceDiffPct)})`}
                      </div>
                    </div>
                  </div>
                )}
                {ev.priceOverThreshold && <div className="text-danger-fg font-medium text-center">แพงกว่าราคาที่ทดไว้เกิน {settings.price_variance_threshold_pct}%</div>}
                <div className="text-right text-xs text-muted-foreground">รวม {formatBaht(ev.amount)} บาท</div>
              </div>
            )}

            {item && ev?.requiresReason && (
              <FormField label="เหตุผล (บังคับ)" error={!line.variance_reason.trim() ? 'ต้องระบุเหตุผลก่อนส่ง' : null}>
                <Textarea value={line.variance_reason} onChange={e => update(line.key, { variance_reason: e.target.value })} placeholder="เช่น ราคาตลาดปรับขึ้น / แบบเปลี่ยนต้องใช้เพิ่ม" />
              </FormField>
            )}

            <FormField label="ซัพพลายเออร์">
              <div className="grid grid-cols-1 gap-2">
                <Select value={line.supplier_id} onChange={e => update(line.key, { supplier_id: e.target.value })}>
                  <option value="">ไม่ระบุ / พิมพ์ชื่อด้านล่าง</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                {!line.supplier_id && <Input value={line.supplier_name} onChange={e => update(line.key, { supplier_name: e.target.value })} placeholder="ชื่อซัพพลายเออร์ (ถ้ายังไม่มีในระบบ)" />}
              </div>
            </FormField>
          </div>
        )
      })}

      <Button type="button" variant="outline" className="w-full" onClick={() => setLines(ls => [...ls, newLine()])} disabled={!projectId}>
        เพิ่มรายการ
      </Button>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FormField label="วันที่ต้องการ">
          <Input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} />
        </FormField>
        <FormField label="หมายเหตุ">
          <Textarea value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">มูลค่ารวม</span><span className="tabular font-semibold">{formatBaht(routing.total)} บาท</span></div>
        <div className="flex justify-between mt-1">
          <span className="text-muted-foreground">เส้นทางอนุมัติ</span>
          <span>{routing.route === 'pm_only' ? 'ผู้จัดการโครงการ' : 'ผู้จัดการโครงการ แล้วต่อด้วยฝ่ายบริหาร'}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          วงเงินผู้จัดการโครงการ {formatBaht(settings.pm_approval_limit)} บาท {settings.qty_over_boq_requires_management ? '· เกิน BOQ ต้องผ่านฝ่ายบริหาร' : ''}
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'กำลังส่ง' : online ? 'ส่งขออนุมัติ' : 'บันทึกไว้ส่งเมื่อออนไลน์'}
      </Button>
    </form>
  )
}
