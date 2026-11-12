'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { readJobNotice, openJob, type JobNoticeDraft, type JobNoticePerson, type ProfileOption } from '@/actions/job-notice'
import { ROLE_LABELS, type UserRole } from '@/lib/types'
import { todayISO } from '@/lib/date'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { DateInput } from './date-input'
import { BoqImportWizard } from './boq-import-wizard'
import { useErrorToast } from './toast'

const SAMPLE = `แจ้ง เปิด Job/เพิ่มแผนก
- A6911-05(V107) งานพับขั้นบันได (รวินท์)
- ผู้รับผิดชอบ ณรงค์ฤทธิ์
- จัดซื้อ สุวรรณญา ค่ะ`

// เปิดงานจากข้อความแจ้งในกลุ่ม LINE: วางข้อความ แนบ BOQ ระบบกรอกให้ ตรวจแล้วกดเปิดงาน
// แนบ BOQ มาด้วย เปิดงานเสร็จจะอ่านไฟล์ต่อทันที มูลค่าสัญญามาจาก BOQ ตอนนำเข้า
// manual: ฟอร์มกรอกเอง แสดงเฉพาะก่อนเปิดงาน
export function JobNoticeEntry({ branches, profiles, manual }: { branches: { id: string; code: string; name: string }[]; profiles: ProfileOption[]; manual?: ReactNode }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [draft, setDraft] = useState<JobNoticeDraft | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState('')
  const [branchId, setBranchId] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [people, setPeople] = useState<JobNoticePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  useErrorToast(error)
  const [pending, setPending] = useState<'read' | 'open' | null>(null)
  const [opened, setOpened] = useState<{ id: string; warning: string | null } | null>(null)

  async function read() {
    setPending('read')
    setError(null)
    const fd = new FormData()
    fd.set('text', text)
    if (file) fd.set('file', file)
    const res = await readJobNotice(fd)
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const d = res.data
    setDraft(d)
    setCode(d.code)
    setName(d.name)
    setCustomer(d.customer_name)
    setBranchId(d.branch_id)
    setPeople(d.people)
  }

  async function open() {
    setPending('open')
    setError(null)
    const res = await openJob({
      code,
      name,
      customer_name: customer,
      branch_id: branchId,
      start_date: startDate || null,
      members: people.filter(p => p.user_id).map(p => ({ user_id: p.user_id!, role: p.role })),
    })
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (!file && !res.data.warning) {
      router.push(`/projects/${res.data.id}`)
      return
    }
    setOpened(res.data)
  }

  const setPerson = (idx: number, patch: Partial<JobNoticePerson>) => setPeople(ps => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  const roleChoices = Object.keys(ROLE_LABELS) as UserRole[]

  if (opened) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          เปิดงาน <span className="font-semibold">{code} {name}</span> แล้ว
          {file ? ' ขั้นต่อไป ระบบกำลังอ่าน BOQ ที่แนบมาให้ด้านล่าง ไม่ต้องอัปโหลดใหม่' : ' '}
          {!file && <Link className="underline" href={`/projects/${opened.id}`}>ไปหน้าโครงการ</Link>}
        </Alert>
        {opened.warning && <Alert tone="warning">{opened.warning}</Alert>}
        {file && (
          <>
            <h2>นำเข้า BOQ</h2>
            <BoqImportWizard projectId={opened.id} hasConfirmed={false} initialType="quotation" currentContract={0} initialFile={file} />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2>เปิดงานจากข้อความแจ้ง</h2>
        <FormField label="ข้อความแจ้งเปิด Job" hint="คัดลอกจากกลุ่ม LINE มาวางได้ทั้งข้อความ บรรทัดที่ขึ้นต้นด้วย @ ระบบข้ามให้">
          <Textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={SAMPLE} />
        </FormField>
        <FormField label="ไฟล์ BOQ (.xlsx) ไม่บังคับ" hint="แนบมาด้วย เปิดงานเสร็จระบบอ่าน BOQ ต่อให้ และใช้ชื่อลูกค้าเต็มจากไฟล์">
          <Input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
        <div className="flex justify-end">
          <Button type="button" onClick={read} disabled={!text.trim() || pending !== null}>
            {pending === 'read' ? 'กำลังอ่าน' : draft ? 'อ่านข้อความใหม่' : 'อ่านข้อความ'}
          </Button>
        </div>
      </section>

      {draft && (
        <section className="rounded border-2 border-primary bg-card p-4 space-y-4">
          <h2>ตรวจก่อนเปิดงาน</h2>
          {draft.duplicate && (
            <Alert tone="danger">
              รหัสงาน {draft.code} มีอยู่แล้ว:{' '}
              <Link className="underline" href={`/projects/${draft.duplicate.id}`}>{draft.duplicate.name}</Link>
              {' '}ถ้าเป็นงานเดียวกันไม่ต้องเปิดใหม่ ถ้าเป็นแผนกใหม่ให้แก้รหัสงาน
            </Alert>
          )}
          {draft.notes.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-5">
                {draft.notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="รหัสงาน">
              <Input value={code} onChange={e => setCode(e.target.value)} required />
            </FormField>
            <FormField label="สาขา">
              <Select value={branchId} onChange={e => setBranchId(e.target.value)} required>
                <option value="">เลือกสาขา</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="ชื่องาน">
                <Input value={name} onChange={e => setName(e.target.value)} required />
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <FormField label="ลูกค้า">
                <Input value={customer} onChange={e => setCustomer(e.target.value)} />
              </FormField>
            </div>
            <FormField label="วันเริ่มงาน">
              <DateInput value={startDate} onChange={setStartDate} />
            </FormField>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">ทีมงาน (เป็นสมาชิกโครงการ)</div>
            {people.length === 0 && <p className="text-sm text-muted-foreground">ข้อความไม่มีชื่อผู้รับผิดชอบหรือจัดซื้อ เพิ่มสมาชิกได้ที่หน้าโครงการ</p>}
            {people.map((p, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-[10rem_1fr]">
                <Select value={p.role} onChange={e => setPerson(idx, { role: e.target.value as UserRole })} aria-label="หน้าที่">
                  {roleChoices.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
                <div className="space-y-1">
                  <Select value={p.user_id ?? ''} onChange={e => setPerson(idx, { user_id: e.target.value || null })} aria-label={`ผู้ใช้สำหรับ ${p.name}`}>
                    <option value="">ไม่เพิ่ม ({p.name} ยังไม่มีบัญชี)</option>
                    {profiles.map(u => <option key={u.id} value={u.id}>{u.full_name} · {ROLE_LABELS[u.role]}</option>)}
                  </Select>
                  <div className="text-xs text-muted-foreground">ในข้อความ: {p.label} {p.name}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>ยกเลิก</Button>
            <Button type="button" onClick={open} disabled={pending !== null || !code.trim() || !name.trim() || !branchId}>
              {pending === 'open' ? 'กำลังเปิดงาน' : file ? 'เปิดงานและนำเข้า BOQ' : 'เปิดงาน'}
            </Button>
          </div>
        </section>
      )}

      {!draft && manual}
    </div>
  )
}
