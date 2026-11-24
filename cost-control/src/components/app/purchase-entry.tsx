'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { Settings } from '@/lib/types'
import type { ActionResult } from '@/actions/types'
import type { PurchaseDocumentResult } from '@/lib/purchase/document-types'
import { useOnline } from '@/lib/hooks/use-online'
import { newClientRef } from '@/lib/offline/queue'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { PrForm, type PrFormProject } from './pr-form'
import { PurchaseDocumentPicker, PurchaseDocumentSummary, prepareFile } from './purchase-document-reader'
import { useToast } from './toast'
import { cn } from '@/lib/utils'

type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'done'
const BADGE: Record<BadgeTone, string> = {
  info: 'bg-brand-tint text-primary',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  done: 'bg-muted text-muted-foreground',
}
const CARD_EDGE: Record<BadgeTone, string> = {
  info: 'border-l-[#93a5d1]',
  success: 'border-l-status-normal',
  warning: 'border-l-status-watch',
  danger: 'border-l-status-alert',
  done: 'border-l-input',
}

// ป้ายสถานะของเอกสารแต่ละใบ ดูแวบเดียวรู้ว่าใบไหนบันทึกได้เลย ใบไหนต้องตรวจ
function docBadge(d: DocEntry): { label: string; tone: BadgeTone } {
  if (d.status === 'queued') return { label: 'รอคิว', tone: 'info' }
  if (d.status === 'reading') return { label: 'กำลังอ่าน', tone: 'info' }
  if (d.status === 'saved') return { label: 'บันทึกแล้ว', tone: 'done' }
  if (d.status === 'error') return { label: 'อ่านไม่สำเร็จ', tone: 'danger' }
  if (d.status === 'unassigned') return { label: 'เลือกโครงการ', tone: 'warning' }
  const r = d.result
  const checks = (r?.issues.length ?? 0) + (r?.lines.filter(l => !l.boq_item_id).length ?? 0) + (r?.read_error ? 1 : 0)
  return checks ? { label: `ต้องตรวจ ${checks} จุด`, tone: 'warning' } : { label: 'พร้อมบันทึก', tone: 'success' }
}

type Status = 'queued' | 'reading' | 'ready' | 'unassigned' | 'error' | 'saved'

interface DocEntry {
  key: string
  name: string
  file: File
  status: Status
  result: PurchaseDocumentResult | null
  error: string | null
  saved: { id: string; pr_no: string } | null
  pick: string // โครงการที่ผู้ใช้เลือกเมื่อระบบหาจากเลขงานไม่ได้
}

// อ่านพร้อมกันได้ไม่เกินเท่านี้ใบ ที่เหลือรอคิว
const PARALLEL = 3

// หน้าบันทึกการสั่งซื้อ: แนบเอกสารได้หลายใบพร้อมกัน คละงานได้ แต่ละใบเป็นหนึ่งรายการสั่งซื้อของโครงการตามเลข JOB
// ไม่ได้แนบเอกสาร ใช้ฟอร์มกรอกเองตามเดิม
export function PurchaseEntry({
  projects,
  suppliers,
  settings,
  initialProjectId,
  directMode,
}: {
  projects: PrFormProject[]
  suppliers: { id: string; name: string }[]
  settings: Settings
  initialProjectId: string | null
  directMode: boolean
}) {
  const online = useOnline()
  const [docs, setDocs] = useState<DocEntry[]>([])
  const toast = useToast()
  const slots = useRef(PARALLEL)
  const waiting = useRef<(() => void)[]>([])

  const patch = (key: string, p: Partial<DocEntry>) => setDocs(ds => ds.map(d => (d.key === key ? { ...d, ...p } : d)))

  async function acquire() {
    if (slots.current > 0) {
      slots.current--
      return
    }
    await new Promise<void>(resolve => waiting.current.push(resolve))
  }
  function release() {
    const next = waiting.current.shift()
    if (next) next()
    else slots.current++
  }

  // อ่านผ่าน Route Handler ให้หลายใบอ่านพร้อมกันได้ และไม่ขวางปุ่มบันทึกของใบที่อ่านเสร็จแล้ว
  // ผลอ่านแต่ละใบเด้งที่มุมขวาล่าง พร้อมปุ่มพาไปที่การ์ดของใบนั้น ไม่ต้องเลื่อนหาเอง
  function announce(entry: { key: string; name: string }, tone: 'danger' | 'warning' | 'success', message: string) {
    toast.show({
      tone,
      message: `${entry.name}: ${message}`,
      action: { label: 'ดู', onClick: () => document.getElementById(`doc-${entry.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    })
  }

  async function read(entry: { key: string; name: string; file: File }, projectId: string | null, doc: PurchaseDocumentResult['unassigned_doc']) {
    await acquire()
    patch(entry.key, { status: 'reading', error: null })
    try {
      const fd = new FormData()
      fd.append('file', entry.file)
      fd.append('candidate_ids', JSON.stringify(projects.map(p => p.id)))
      if (projectId) fd.append('project_id', projectId)
      if (doc) fd.append('doc', JSON.stringify(doc))
      const res = await fetch('/api/purchase-documents', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as ActionResult<PurchaseDocumentResult> | null
      if (!json) {
        const msg = `อ่านไม่สำเร็จ (HTTP ${res.status}) ลองใหม่อีกครั้ง`
        patch(entry.key, { status: 'error', error: msg })
        announce(entry, 'danger', msg)
      } else if (!json.ok) {
        patch(entry.key, { status: 'error', error: json.error })
        announce(entry, 'danger', json.error)
      } else {
        const r = json.data
        patch(entry.key, { status: r.project_id ? 'ready' : 'unassigned', result: r })
        const unmatched = r.lines.filter(l => !l.boq_item_id).length
        if (r.read_error) announce(entry, 'warning', r.read_error)
        else if (!r.project_id) announce(entry, 'warning', 'หาโครงการจากเลขงานไม่เจอ เลือกโครงการให้ใบนี้')
        else if (r.issues.length) announce(entry, 'warning', `ตัวเลขในเอกสารไม่ตรงกัน ${r.issues.length} จุด ตรวจกับเอกสารจริง`)
        else if (unmatched) announce(entry, 'warning', `ยังไม่ได้จับคู่ BOQ ${unmatched} บรรทัด`)
        else announce(entry, 'success', `อ่านเสร็จ ${r.lines.length} รายการ`)
      }
    } catch {
      patch(entry.key, { status: 'error', error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' })
      announce(entry, 'danger', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง')
    } finally {
      release()
    }
  }

  async function addFiles(files: File[]) {
    const prepared = await Promise.all(files.map(prepareFile))
    const entries: DocEntry[] = prepared.map((file, i) => ({
      key: newClientRef(),
      name: files[i].name || `เอกสาร ${i + 1}`,
      file,
      status: 'queued',
      result: null,
      error: null,
      saved: null,
      pick: '',
    }))
    setDocs(ds => [...ds, ...entries])
    for (const e of entries) void read(e, null, null)
  }

  const remove = (key: string) => setDocs(ds => ds.filter(d => d.key !== key))
  const savedCount = docs.filter(d => d.status === 'saved').length
  const busy = docs.filter(d => d.status === 'queued' || d.status === 'reading').length

  if (!online) {
    return <PrForm projects={projects} suppliers={suppliers} settings={settings} initialProjectId={initialProjectId} directMode={directMode} />
  }

  return (
    <div className="space-y-4">
      <PurchaseDocumentPicker onFiles={files => void addFiles(files)} count={docs.length} />

      {docs.length === 0 ? (
        <PrForm projects={projects} suppliers={suppliers} settings={settings} initialProjectId={initialProjectId} directMode={directMode} />
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">เอกสาร {docs.length} ใบ</span>
              <span className="text-muted-foreground">
                อ่านแล้ว {docs.length - busy}{busy ? ` · กำลังอ่าน ${busy}` : ''} · บันทึกแล้ว {savedCount}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div className="h-full bg-primary transition-all" style={{ width: `${((docs.length - busy) / docs.length) * 100}%` }} />
            </div>
            {busy === 0 && (
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDocs([])}>
                  {savedCount === docs.length ? 'เริ่มชุดใหม่' : 'ล้างทั้งหมด'}
                </Button>
              </div>
            )}
          </div>

          {docs.map((d, idx) => (
            <section key={d.key} id={`doc-${d.key}`} aria-busy={d.status === 'queued' || d.status === 'reading'} className={cn('scroll-mt-16 space-y-3 rounded-md border border-l-4 border-border bg-card p-3', CARD_EDGE[docBadge(d).tone])}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">ใบที่ {idx + 1}{d.result?.document_no ? ` · ${d.result.document_no}` : ''}</div>
                  <div className="truncate text-base font-bold">{d.result?.supplier_name || d.name}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={cn('whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-bold', BADGE[docBadge(d).tone])}>{docBadge(d).label}</span>
                  {(d.status === 'ready' || d.status === 'unassigned' || d.status === 'error') && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => remove(d.key)}>
                      ลบ
                    </Button>
                  )}
                </div>
              </div>

              {(d.status === 'queued' || d.status === 'reading') && (
                <div className="space-y-2">
                  <div className="h-3.5 w-3/5 animate-pulse rounded bg-border" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  <p className="text-[13px] text-muted-foreground">{d.status === 'queued' ? 'รอคิวอ่าน' : 'กำลังอ่าน ใช้เวลาประมาณ 30 วินาทีถึง 1 นาที บันทึกใบอื่นระหว่างรอได้'}</p>
                </div>
              )}

              {d.status === 'saved' && d.saved && (
                <Alert tone="success">
                  บันทึกแล้ว <Link className="underline" href={`/pr/${d.saved.id}`}>{d.saved.pr_no}</Link>
                </Alert>
              )}

              {(d.status === 'error' || d.status === 'unassigned') && (
                <div className="space-y-3">
                  {d.status === 'error' && <Alert tone="danger">{d.error}</Alert>}
                  {d.status === 'unassigned' && d.result && <PurchaseDocumentSummary result={d.result} />}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select value={d.pick} onChange={e => patch(d.key, { pick: e.target.value })} className="sm:flex-1">
                      <option value="">{d.status === 'error' ? 'อ่านใหม่โดยให้ระบบหาโครงการ' : 'เลือกโครงการ'}</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                    </Select>
                    <Button
                      type="button"
                      disabled={d.status === 'unassigned' && !d.pick}
                      onClick={() => void read(d, d.pick || null, d.status === 'unassigned' ? d.result?.unassigned_doc ?? null : null)}
                    >
                      {d.status === 'unassigned' ? 'ใช้โครงการนี้' : 'อ่านใหม่'}
                    </Button>
                  </div>
                </div>
              )}

              {d.status === 'ready' && d.result && (
                <>
                  <PurchaseDocumentSummary result={d.result} />
                  <PrForm
                    projects={projects}
                    suppliers={suppliers}
                    settings={settings}
                    initialProjectId={null}
                    directMode={directMode}
                    initialDocument={d.result}
                    onSaved={pr => patch(d.key, { status: 'saved', saved: pr })}
                  />
                </>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
