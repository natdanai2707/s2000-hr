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
  async function read(entry: { key: string; file: File }, projectId: string | null, doc: PurchaseDocumentResult['unassigned_doc']) {
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
        patch(entry.key, { status: 'error', error: `อ่านไม่สำเร็จ (HTTP ${res.status}) ลองใหม่อีกครั้ง` })
      } else if (!json.ok) {
        patch(entry.key, { status: 'error', error: json.error })
      } else {
        patch(entry.key, { status: json.data.project_id ? 'ready' : 'unassigned', result: json.data })
      }
    } catch {
      patch(entry.key, { status: 'error', error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' })
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
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              เอกสาร {docs.length} ใบ{busy ? ` · กำลังอ่าน ${busy} ใบ` : ''} · บันทึกแล้ว {savedCount} ใบ
            </span>
            {busy === 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setDocs([])}>
                {savedCount === docs.length ? 'เริ่มชุดใหม่' : 'ล้างทั้งหมด'}
              </Button>
            )}
          </div>

          {docs.map((d, idx) => (
            <section key={d.key} className="rounded-xl border-2 border-border p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">ใบที่ {idx + 1}</div>
                  <div className="text-xs text-muted-foreground truncate">{d.name}</div>
                </div>
                {(d.status === 'ready' || d.status === 'unassigned' || d.status === 'error') && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => remove(d.key)}>
                    ลบ
                  </Button>
                )}
              </div>

              {(d.status === 'queued' || d.status === 'reading') && (
                <p className="text-sm text-muted-foreground">{d.status === 'queued' ? 'รอคิวอ่าน' : 'กำลังอ่านเอกสาร ใช้เวลาประมาณ 30 วินาทีถึง 1 นาที'}</p>
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
