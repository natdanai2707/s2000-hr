'use client'

import { useMemo, useRef, useState } from 'react'
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
import { VatPriceInput } from './vat-price-input'
import type { PurchaseDocumentResult } from '@/lib/purchase/document-types'
import { formatThaiDate } from '@/lib/date'
import { suggestConversion, toBoqUnits } from '@/lib/units'
import { SupplierCombobox } from './supplier-combobox'
import { addVat } from '@/lib/vat'
import { cn } from '@/lib/utils'
import { useToast } from './toast'

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
  // ซื้อเป็นหน่วยอื่นจาก BOQ: ปริมาณและราคาในบรรทัดเป็นหน่วยที่ซื้อ factor = หน่วย BOQ ต่อหนึ่งหน่วยที่ซื้อ
  buy_other: boolean
  buy_unit: string
  factor: string
  // มาจากเอกสารที่ Claude อ่าน แสดงให้ผู้ใช้เทียบตอนเลือกรายการ BOQ
  doc_desc: string // ชื่อสินค้าตามเอกสาร ใช้เป็นหัวการ์ดเมื่อยังไม่ได้เลือก BOQ หรือเป็นของนอก BOQ
  doc_note: string
  // null = ให้ระบบเลือก: รายการที่ต้องแก้กางไว้ รายการที่เรียบร้อยพับไว้ ผู้ใช้กดหัวการ์ดเพื่อเปิดปิดเอง
  open: boolean | null
}

function newLine(): Line {
  return { key: newClientRef(), boq_item_id: '', search: '', qty: '', unit_price: '', supplier_id: '', supplier_name: '', variance_reason: '', buy_other: false, buy_unit: '', factor: '', doc_desc: '', doc_note: '', open: true }
}

// null = ซื้อเป็นหน่วยอื่นแต่ยังไม่ระบุตัวแปลง (ผู้ใช้เว้นว่างได้) NaN = กรอกค่าที่ใช้ไม่ได้
function lineFactor(l: Line): number | null {
  if (!l.buy_other) return 1
  if (l.factor.trim() === '') return null
  const f = Number(l.factor)
  return f > 0 ? f : NaN
}

function knownFactor(l: Line): number | null {
  const f = lineFactor(l)
  return f === null || Number.isNaN(f) ? null : f
}

// แปลงผลอ่านเอกสารเป็นบรรทัดในฟอร์ม ผู้ใช้ตรวจและแก้ได้ทุกช่องก่อนบันทึก
function linesFromDocument(r: PurchaseDocumentResult, items: PrFormItem[], suppliers: { id: string; name: string }[]): Line[] {
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()
  const sup = r.supplier_name ? suppliers.find(x => norm(x.name) === norm(r.supplier_name!)) : undefined
  return r.lines.map(rl => {
    const item = items.find(i => i.id === rl.boq_item_id)
    const differ = rl.qty_factor !== 1
    return {
      ...newLine(),
      boq_item_id: item?.id ?? '',
      qty: rl.qty !== null ? String(rl.qty) : '',
      unit_price: rl.unit_price !== null ? String(rl.unit_price) : '',
      supplier_id: sup?.id ?? '',
      supplier_name: sup?.name ?? r.supplier_name ?? '',
      buy_other: !!item && differ,
      buy_unit: differ ? rl.unit ?? '' : '',
      factor: differ && rl.qty_factor ? String(rl.qty_factor) : '',
      doc_desc: rl.description,
      doc_note: rl.note ?? '',
      open: null,
    }
  })
}

function documentNote(r: PurchaseDocumentResult): string {
  const ref = [r.document_no && `เลขที่ ${r.document_no}`, r.document_date && `วันที่ ${formatThaiDate(r.document_date)}`].filter(Boolean).join(' ')
  return ref ? `จากเอกสาร ${ref}` : ''
}

type Tone = 'ok' | 'warn' | 'danger' | 'idle'
const TONE_BORDER: Record<Tone, string> = { ok: 'border-l-status-normal', warn: 'border-l-status-watch', danger: 'border-l-status-alert', idle: 'border-l-border' }
const CHIP: Record<Tone, string> = {
  ok: 'bg-success-bg text-success-fg',
  warn: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  idle: 'bg-muted text-muted-foreground',
}

// สถานะของบรรทัดสำหรับหัวการ์ด: ป้ายสั้นๆ สีตามความรุนแรง และต้องให้ผู้ใช้แก้หรือไม่ (กางการ์ดไว้ให้)
function lineStatus({ item, ev, line, unitsUnknown }: { item: PrFormItem | null; ev: ReturnType<typeof evaluateLine> | null; line: Line; unitsUnknown: boolean }) {
  const chips: { text: string; tone: Tone }[] = []
  if (!item) return { tone: 'warn' as Tone, attention: true, chips: [{ text: 'เลือกรายการ BOQ', tone: 'warn' as Tone }] }
  const missing = line.qty === '' || line.unit_price === '' || !(Number(line.qty) > 0)
  if (missing) chips.push({ text: 'กรอกปริมาณและราคา', tone: 'warn' })
  if (item.is_off_boq) chips.push({ text: 'นอก BOQ', tone: 'warn' })
  if (ev?.qtyOverBoq) chips.push({ text: 'เกิน BOQ', tone: 'danger' })
  if (ev?.priceOverThreshold) chips.push({ text: `แพงกว่าต้นทุน${ev.priceDiffPct !== null ? ` ${formatPct(ev.priceDiffPct)}` : ''}`, tone: 'danger' })
  else if (ev && !item.is_off_boq && !unitsUnknown && ev.priceDiff > 0 && !missing) chips.push({ text: 'แพงกว่าต้นทุนเล็กน้อย', tone: 'warn' })
  if (unitsUnknown) chips.push({ text: 'ยังไม่ระบุตัวแปลงหน่วย', tone: 'idle' })
  const needReason = !!ev?.requiresReason && !line.variance_reason.trim()
  if (needReason) chips.push({ text: 'ต้องใส่เหตุผล', tone: 'danger' })
  if (chips.length === 0) chips.push({ text: ev?.priceBelow ? 'ถูกกว่าต้นทุน' : 'ตรงงบ', tone: 'ok' })
  const tone: Tone = chips.some(c => c.tone === 'danger') ? 'danger' : chips.some(c => c.tone === 'warn') ? 'warn' : 'ok'
  return { tone, attention: missing || needReason, chips }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// initialDocument = เอกสารที่ Claude อ่านแล้ว ฟอร์มเริ่มจากโครงการและรายการในเอกสาร
// onSaved = ใช้ในการแนบหลายใบ บันทึกแล้วไม่เปลี่ยนหน้า ให้ผู้ใช้ทำใบถัดไปต่อ
export function PrForm({
  projects,
  suppliers,
  settings,
  initialProjectId,
  directMode = false,
  initialDocument,
  onSaved,
}: {
  projects: PrFormProject[]
  suppliers: { id: string; name: string }[]
  settings: Settings
  initialProjectId: string | null
  directMode?: boolean
  initialDocument?: PurchaseDocumentResult
  onSaved?: (pr: { id: string; pr_no: string }) => void
}) {
  const router = useRouter()
  const startProject = initialDocument?.project_id ?? initialProjectId
  const [projectId, setProjectId] = useState(startProject && projects.some(p => p.id === startProject) ? startProject : projects.length === 1 ? projects[0].id : '')
  const [lines, setLines] = useState<Line[]>(() => {
    const docLines = initialDocument ? linesFromDocument(initialDocument, projects.find(p => p.id === initialDocument.project_id)?.items ?? [], suppliers) : []
    return docLines.length ? docLines : [newLine()]
  })
  const [note, setNote] = useState(() => (initialDocument ? documentNote(initialDocument) : ''))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null)
  const [attachmentPath, setAttachmentPath] = useState<string | null>(initialDocument?.attachment_path ?? null)
  const online = useOnline()
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)

  // ข้อผิดพลาดเด้งที่มุมขวาล่าง ไม่ต้องเลื่อนขึ้นไปดูหัวฟอร์ม ถ้าเป็นของรายการใด กางการ์ดและมีปุ่มพาไปที่รายการนั้น
  function goToLine(key: string) {
    setLines(ls => ls.map(l => (l.key === key ? { ...l, open: true } : l)))
    // id ของการ์ดใช้ลำดับ ไม่ใช้ key ที่สุ่ม เพราะ key ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์ไม่ตรงกัน
    const idx = lines.findIndex(l => l.key === key)
    requestAnimationFrame(() => formRef.current?.querySelector(`#pr-line-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function fail(message: string, key?: string) {
    setError(message)
    if (key) setLines(ls => ls.map(l => (l.key === key ? { ...l, open: true } : l)))
    toast.show({ tone: 'danger', message, action: key ? { label: 'ไปที่รายการ', onClick: () => goToLine(key) } : undefined })
  }

  const project = projects.find(p => p.id === projectId)
  const items = useMemo(() => project?.items ?? [], [project])

  // เทียบกับ BOQ ในหน่วยของ BOQ เสมอ ยอดเงินเท่าเดิมไม่ว่าจะซื้อเป็นหน่วยไหน
  const evaluated = lines.map(l => {
    const item = items.find(i => i.id === l.boq_item_id)
    if (!item) return { line: l, item: null, ev: null, boq: null, input: null, unitsUnknown: false }
    const f = knownFactor(l)
    const unitsUnknown = l.buy_other && f === null
    const boq = toBoqUnits(Number(l.qty) || 0, Number(l.unit_price) || 0, f ?? 1)
    const input = { qty: boq.qty, unitPrice: boq.unitPrice, boqQty: item.qty, boqUnitCost: item.unit_cost, qtyOrdered: item.qty_ordered, isOffBoq: item.is_off_boq, varianceReason: l.variance_reason, unitsUnknown }
    return { line: l, item, ev: evaluateLine(input, settings), boq, input, unitsUnknown }
  })
  const attentionCount = evaluated.filter(e => lineStatus({ item: e.item, ev: e.ev, line: e.line, unitsUnknown: e.unitsUnknown }).attention).length
  const routing = routePurchaseRequest(
    evaluated.filter(e => e.item).map(e => e.input!),
    settings
  )

  // เลือกรายการ BOQ: ถ้าเป็นเหล็กที่ BOQ คิดเป็นกิโลและบอกน้ำหนักกับความยาว ตั้งให้ซื้อเป็นเส้นพร้อมตัวแปลง
  function chooseItem(line: Line, i: PrFormItem) {
    const sug = suggestConversion(i.description, i.unit)
    if (sug) {
      update(line.key, { boq_item_id: i.id, search: '', buy_other: true, buy_unit: sug.unit, factor: String(sug.factor), unit_price: line.unit_price || String(round2(i.unit_cost * sug.factor)) })
    } else {
      update(line.key, { boq_item_id: i.id, search: '', buy_other: false, buy_unit: '', factor: '', unit_price: line.unit_price || String(i.unit_cost) })
    }
  }

  // เปิดปิดการซื้อเป็นหน่วยอื่น แปลงปริมาณและราคาที่กรอกไว้ให้ตามหน่วยใหม่
  function toggleBuyOther(line: Line, item: PrFormItem, on: boolean) {
    const f = on ? Number(line.factor) || suggestConversion(item.description, item.unit)?.factor || 0 : knownFactor(line) ?? 0
    const ok = f > 0
    update(line.key, {
      buy_other: on,
      buy_unit: on ? line.buy_unit || suggestConversion(item.description, item.unit)?.unit || '' : line.buy_unit,
      factor: on && ok ? String(f) : line.factor,
      qty: line.qty === '' || !ok ? line.qty : String(Math.round((on ? Number(line.qty) / f : Number(line.qty) * f) * 1000) / 1000),
      unit_price: line.unit_price === '' || !ok ? line.unit_price : String(round2(on ? Number(line.unit_price) * f : Number(line.unit_price) / f)),
    })
  }

  // แก้ช่องใดในการ์ดที่ระบบกางไว้ให้ ตรึงให้กางอยู่ ไม่ให้การ์ดพับเองกลางคันเมื่อสถานะกลายเป็นเรียบร้อย
  function update(key: string, patch: Partial<Line>) {
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...('open' in patch ? {} : { open: l.open ?? true }), ...patch } : l)))
  }

  // ข้อผิดพลาดของบรรทัดบอกเลขรายการและ key ไว้ ให้ข้อความเตือนพาไปที่การ์ดนั้นได้
  function buildPayload(): QueuedPrPayload | { error: string; key?: string } {
    if (!projectId) return { error: 'กรุณาเลือกโครงการ' }
    const payloadLines: PrLinePayload[] = []
    for (const [idx, e] of evaluated.entries()) {
      const bad = (msg: string) => ({ error: `รายการที่ ${idx + 1}: ${msg}`, key: e.line.key })
      if (!e.item) return bad('ยังไม่ได้เลือกรายการ BOQ')
      const qty = Number(e.line.qty)
      const price = Number(e.line.unit_price)
      const factor = lineFactor(e.line)
      if (e.line.buy_other && !e.line.buy_unit.trim()) return bad('กรุณาระบุหน่วยที่ซื้อ')
      if (factor !== null && Number.isNaN(factor)) return bad('ตัวแปลงหน่วยต้องมากกว่า 0 หรือเว้นว่างไว้')
      if (!(qty > 0)) return bad('ปริมาณต้องมากกว่า 0')
      if (!(price >= 0) || e.line.unit_price === '') return bad('กรุณากรอกราคาต่อหน่วย')
      if (e.ev!.requiresReason && !e.line.variance_reason.trim()) return bad('กรุณาระบุเหตุผล (เกิน BOQ เกินราคาที่ทดไว้ หรือนอก BOQ)')
      payloadLines.push({
        boq_item_id: e.item.id,
        description: e.item.description,
        qty,
        unit: e.line.buy_other ? e.line.buy_unit.trim() : e.item.unit,
        unit_price: price,
        qty_factor: factor,
        // ชื่อใหม่ที่ยังไม่มีในระบบ ฐานข้อมูลจะบันทึกเข้ารายชื่อซัพพลายเออร์ให้ตอนบันทึก
        supplier_id: e.line.supplier_id || null,
        supplier_name: e.line.supplier_name.trim() || null,
        variance_reason: e.line.variance_reason.trim() || null,
      })
    }
    return { client_ref: newClientRef(), project_id: projectId, needed_by_date: null, note: note.trim() || null, attachment_path: attachmentPath, lines: payloadLines }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    toast.dismiss()
    const payload = buildPayload()
    if ('error' in payload) {
      fail(payload.error, payload.key)
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
        fail(res.error)
        return
      }
      if (onSaved) {
        onSaved(res.data)
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
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      {!online && <Alert tone="warning">ออฟไลน์ ฟอร์มที่ส่งจะถูกเก็บไว้และส่งอัตโนมัติเมื่อกลับมาออนไลน์</Alert>}
      {queuedMsg && <Alert tone="success">{queuedMsg}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FormField label="โครงการ">
          <Select value={projectId} onChange={e => { setProjectId(e.target.value); setLines([newLine()]); setAttachmentPath(null) }} required>
            <option value="" disabled>เลือกโครงการ</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </Select>
        </FormField>
      </div>

      {lines.length > 2 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {lines.length} รายการ{attentionCount > 0 && <span className="text-danger-fg font-medium"> · ต้องแก้ {attentionCount}</span>}
          </span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines(ls => ls.map(l => ({ ...l, open: true })))}>กางทั้งหมด</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines(ls => ls.map(l => ({ ...l, open: null })))}>พับที่เรียบร้อย</Button>
          </span>
        </div>
      )}

      {evaluated.map(({ line, item, ev, boq, unitsUnknown }, idx) => {
        const q = line.search.trim().toLowerCase()
        const matches = q && !item ? items.filter(i => `${i.item_no ?? ''} ${i.description} ${i.unit ?? ''}`.toLowerCase().includes(q)).slice(0, 12) : []
        const status = lineStatus({ item, ev, line, unitsUnknown })
        const expanded = line.open ?? status.attention
        const unitLabel = line.buy_other && line.buy_unit ? line.buy_unit : item?.unit ?? ''
        return (
          <div key={line.key} id={`pr-line-${idx}`} className={cn('scroll-mt-16 rounded-xl border border-border border-l-4 bg-card shadow-sm', TONE_BORDER[status.tone])}>
            {/* หัวการ์ด: เห็นรายการ ยอดเงิน และสถานะในบรรทัดเดียว แตะเพื่อเปิดปิด */}
            <button
              type="button"
              onClick={() => update(line.key, { open: !expanded })}
              aria-expanded={expanded}
              className="flex w-full items-start gap-3 p-3 text-left md:p-4"
            >
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{idx + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-snug">
                  {item && !item.is_off_boq ? `${item.item_no ? `${item.item_no} ` : ''}${item.description}` : line.doc_desc || item?.description || 'รายการใหม่'}
                </span>
                {item && !item.is_off_boq && line.doc_desc && (
                  <span className="block text-xs text-muted-foreground leading-snug">ในเอกสาร: {line.doc_desc}</span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {line.qty !== '' && line.unit_price !== '' && (
                    <span className="tabular text-muted-foreground">
                      {formatQty(Number(line.qty))} {unitLabel} × {formatBaht(Number(line.unit_price))}
                    </span>
                  )}
                  {status.chips.map(c => (
                    <span key={c.text} className={cn('rounded-full px-2 py-0.5 font-medium', CHIP[c.tone])}>{c.text}</span>
                  ))}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block tabular font-semibold">{ev ? formatBaht(ev.amount) : '-'}</span>
                <span className={cn('mt-1 inline-block text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden="true">▾</span>
              </span>
            </button>

            {expanded && (
            <div className="space-y-4 rounded-b-xl border-t border-border bg-muted/20 p-3 md:p-4">

            {/* ชื่อและปริมาณตามเอกสารอยู่ที่หัวการ์ดแล้ว ตรงนี้แสดงเฉพาะข้อสังเกตจากการอ่าน */}
            {line.doc_note && (
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
                <span className="text-muted-foreground">ข้อสังเกตจากเอกสาร: </span>{line.doc_note}
              </div>
            )}
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
                          <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => chooseItem(line, i)}>
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

            {item && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4" checked={line.buy_other} onChange={e => toggleBuyOther(line, item, e.target.checked)} />
                ซื้อเป็นหน่วยอื่นจาก BOQ{item.unit ? ` (BOQ คิดเป็น ${item.unit})` : ''}
              </label>
            )}
            {item && line.buy_other && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label="หน่วยที่ซื้อ">
                  <Input value={line.buy_unit} onChange={e => update(line.key, { buy_unit: e.target.value })} placeholder="เช่น เส้น แผ่น" required />
                </FormField>
                <FormField
                  label={`1 ${line.buy_unit || 'หน่วย'} = กี่ ${item.unit ?? 'หน่วย BOQ'}`}
                  hint={suggestConversion(item.description, item.unit) ? `คำนวณจาก ${suggestConversion(item.description, item.unit)!.note}` : undefined}
                >
                  <Input type="number" step="0.001" min="0" inputMode="decimal" value={line.factor} onChange={e => update(line.key, { factor: e.target.value })} placeholder="ไม่ทราบ เว้นว่างได้" />
                </FormField>
              </div>
            )}

            <FormField label={`ปริมาณ${line.buy_other && line.buy_unit ? ` (${line.buy_unit})` : item?.unit ? ` (${item.unit})` : ''}`}>
              <Input type="number" step="0.001" min="0" inputMode="decimal" value={line.qty} onChange={e => update(line.key, { qty: e.target.value })} required />
            </FormField>
            <VatPriceInput
              label={line.buy_other && line.buy_unit ? `ราคาต่อ${line.buy_unit}` : 'ราคาต่อหน่วย'}
              value={line.unit_price}
              onChange={v => update(line.key, { unit_price: v })}
              required
              invalid={!!ev?.priceOverThreshold}
            />
            {item && line.buy_other && boq && knownFactor(line) !== null && line.qty !== '' && (
              <p className="text-xs text-muted-foreground tabular">
                = {formatQty(boq.qty)} {item.unit ?? ''} · ราคา {formatBaht(boq.unitPrice)} บาทต่อ {item.unit ?? 'หน่วย'} (ไม่รวม VAT)
              </p>
            )}

            {item && ev && unitsUnknown && (line.qty !== '' || line.unit_price !== '') && (
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-1">
                <div>
                  ยังไม่ระบุว่า 1 {line.buy_unit || 'หน่วย'} เท่ากับกี่ {item.unit ?? 'หน่วย BOQ'} ระบบนับยอดเงินเข้าต้นทุนของรายการนี้ครบ
                  แต่ยังไม่เทียบปริมาณและราคาต่อหน่วยกับ BOQ ดูทุนเทียบราคาขายของรายการนี้ได้ที่หน้าสรุปต้นทุน
                </div>
                <div className="text-right text-xs text-muted-foreground tabular">
                  รวม {formatBaht(ev.amount)} บาท (ไม่รวม VAT) · {formatBaht(addVat(ev.amount))} บาท (รวม VAT)
                </div>
              </div>
            )}

            {item && ev && !unitsUnknown && (line.qty !== '' || line.unit_price !== '') && (
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-2">
                <div className="grid grid-cols-4 gap-1 text-center">
                  <div><div className="text-xs text-muted-foreground">ตาม BOQ</div><div className="tabular">{item.is_off_boq ? '-' : formatQty(item.qty)}</div></div>
                  <div><div className="text-xs text-muted-foreground">สั่งแล้ว</div><div className="tabular">{formatQty(item.qty_ordered)}</div></div>
                  <div><div className="text-xs text-muted-foreground">คงเหลือ</div><div className="tabular">{item.is_off_boq ? '-' : formatQty(ev.qtyRemaining)}</div></div>
                  <div><div className="text-xs text-muted-foreground">ครั้งนี้</div><div className="tabular">{formatQty(boq?.qty ?? 0)}</div></div>
                </div>
                {ev.qtyOverBoq && <div className="text-danger-fg font-medium text-center">เกิน BOQ {formatQty(ev.qtyOverBy)} {item.unit ?? 'หน่วย'}</div>}
                {!item.is_off_boq && (
                  <div className="grid grid-cols-3 gap-1 text-center border-t border-border pt-2">
                    <div><div className="text-xs text-muted-foreground">ต้นทุนที่ทดต่อ {item.unit ?? 'หน่วย'} (ไม่รวม VAT)</div><div className="tabular">{formatBaht(item.unit_cost)}</div></div>
                    <div><div className="text-xs text-muted-foreground">ราคาครั้งนี้ต่อ {item.unit ?? 'หน่วย'} (ไม่รวม VAT)</div><div className="tabular">{formatBaht(boq?.unitPrice ?? 0)}</div></div>
                    <div>
                      <div className="text-xs text-muted-foreground">ส่วนต่าง</div>
                      <div className={cn('tabular', ev.priceOverThreshold && 'text-danger-fg font-medium', ev.priceBelow && 'text-success-fg font-medium')}>
                        {line.unit_price === '' ? '-' : `${ev.priceDiff >= 0 ? '+' : ''}${formatBaht(ev.priceDiff)} (${ev.priceDiffPct === null ? '-' : formatPct(ev.priceDiffPct)})`}
                      </div>
                    </div>
                  </div>
                )}
                {ev.priceOverThreshold && <div className="text-danger-fg font-medium text-center">แพงกว่าต้นทุนที่ทดไว้เกิน {settings.price_variance_threshold_pct}%</div>}
                {/* แพงกว่าต้นทุนแม้ไม่ถึงเกณฑ์ก็ต้องเห็น ยอดเกินเล็กๆ หลายรายการรวมกันทำให้กำไรหายได้ */}
                {!item.is_off_boq && !ev.priceOverThreshold && ev.priceDiff > 0 && (
                  <div className="text-warning-fg font-medium text-center">
                    แพงกว่าต้นทุนที่ทดไว้ {formatBaht(ev.priceDiff)} บาทต่อ {item.unit ?? 'หน่วย'} รวม {formatBaht(ev.priceDiff * (boq?.qty ?? 0))} บาท
                  </div>
                )}
                <div className="text-right text-xs text-muted-foreground tabular">
                  รวม {formatBaht(ev.amount)} บาท (ไม่รวม VAT) · {formatBaht(addVat(ev.amount))} บาท (รวม VAT)
                </div>
              </div>
            )}

            {item && ev?.requiresReason && (
              <FormField label="เหตุผล (บังคับ)" error={!line.variance_reason.trim() ? 'ต้องระบุเหตุผลก่อนส่ง' : null}>
                <Textarea value={line.variance_reason} onChange={e => update(line.key, { variance_reason: e.target.value })} placeholder="เช่น ราคาตลาดปรับขึ้น / แบบเปลี่ยนต้องใช้เพิ่ม" />
              </FormField>
            )}

            <FormField label="ซัพพลายเออร์" hint="ไม่บังคับ">
              <SupplierCombobox
                suppliers={suppliers}
                value={{ id: line.supplier_id, name: line.supplier_name }}
                onChange={v => update(line.key, { supplier_id: v.id, supplier_name: v.name })}
              />
            </FormField>

            <div className="flex justify-between gap-2 border-t border-border pt-3">
              {lines.length > 1 ? (
                <Button type="button" size="sm" variant="ghost" className="text-danger-fg" onClick={() => setLines(ls => ls.filter(l => l.key !== line.key))}>ลบรายการนี้</Button>
              ) : <span />}
              <Button type="button" size="sm" variant="outline" onClick={() => update(line.key, { open: false })}>พับ</Button>
            </div>
            </div>
            )}
          </div>
        )
      })}

      <Button type="button" variant="outline" className="w-full" onClick={() => setLines(ls => [...ls, newLine()])} disabled={!projectId}>
        เพิ่มรายการ
      </Button>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FormField label="หมายเหตุ">
          <Textarea value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">มูลค่ารวม (ไม่รวม VAT)</span><span className="tabular font-semibold">{formatBaht(routing.total)} บาท</span></div>
        <div className="flex justify-between mt-1"><span className="text-muted-foreground">มูลค่ารวม (รวม VAT)</span><span className="tabular">{formatBaht(addVat(routing.total))} บาท</span></div>
        {directMode ? (
          <p className="text-xs text-muted-foreground mt-2">บันทึกแล้วนับเป็นต้นทุนจริงของโครงการทันที ไม่ต้องอนุมัติ ออกใบสั่งซื้อ หรือรับของ</p>
        ) : (
          <>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">เส้นทางอนุมัติ</span>
              <span>{routing.route === 'pm_only' ? 'ผู้จัดการโครงการ' : 'ผู้จัดการโครงการ แล้วต่อด้วยฝ่ายบริหาร'}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              วงเงินผู้จัดการโครงการ {formatBaht(settings.pm_approval_limit)} บาท {settings.qty_over_boq_requires_management ? '· เกิน BOQ ต้องผ่านฝ่ายบริหาร' : ''}
            </p>
          </>
        )}
      </div>

      {/* มือถือ: ยอดรวมและปุ่มบันทึกติดอยู่เหนือเมนูล่าง ไม่ต้องเลื่อนลงไปหา */}
      <div className="sticky bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <div className="mb-1.5 flex justify-between text-sm md:hidden">
          <span className="text-muted-foreground">รวม {lines.length} รายการ (ไม่รวม VAT)</span>
          <span className="tabular font-semibold">{formatBaht(routing.total)}</span>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'กำลังบันทึก' : !online ? 'บันทึกไว้ส่งเมื่อออนไลน์' : directMode ? 'บันทึกการสั่งซื้อ' : 'ส่งขออนุมัติ'}
        </Button>
      </div>
    </form>
  )
}
