'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createExpense } from '@/actions/expenses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import { todayISO } from '@/lib/date'

interface Item {
  id: string
  item_no: string | null
  description: string
  unit: string | null
  is_off_boq: boolean
}
interface Project {
  id: string
  code: string
  name: string
  items: Item[]
}

export function ExpenseForm({ projects, initialProjectId }: { projects: Project[]; initialProjectId: string | null }) {
  const router = useRouter()
  const [projectId, setProjectId] = useState(initialProjectId && projects.some(p => p.id === initialProjectId) ? initialProjectId : projects.length === 1 ? projects[0].id : '')
  const [itemId, setItemId] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const project = projects.find(p => p.id === projectId)
  const item = project?.items.find(i => i.id === itemId)
  const q = search.trim().toLowerCase()
  const matches = project && q && !item ? project.items.filter(i => `${i.item_no ?? ''} ${i.description}`.toLowerCase().includes(q)).slice(0, 12) : []

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('project_id', projectId)
    fd.set('boq_item_id', itemId)
    fd.set('is_off_boq', item?.is_off_boq ? 'true' : 'false')
    const res = await createExpense(fd)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/projects/${projectId}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <FormField label="โครงการ">
        <Select value={projectId} onChange={e => { setProjectId(e.target.value); setItemId(''); setSearch('') }} required>
          <option value="" disabled>เลือกโครงการ</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
        </Select>
      </FormField>
      <FormField label="รายการ BOQ" hint="ค่าใช้จ่ายทุกรายการต้องผูกกับรายการ BOQ ถ้าไม่มีให้เลือก นอก BOQ และระบุเหตุผล">
        {item ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-sm">
            <span>{item.item_no ? `${item.item_no} ` : ''}{item.description}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setItemId('')}>เปลี่ยน</Button>
          </div>
        ) : (
          <div>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา หรือพิมพ์ นอก BOQ" disabled={!projectId} />
            {matches.length > 0 && (
              <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
                {matches.map(i => (
                  <li key={i.id}>
                    <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => { setItemId(i.id); setSearch('') }}>
                      {i.item_no ? `${i.item_no} ` : ''}{i.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </FormField>
      {item?.is_off_boq && (
        <FormField label="เหตุผลนอก BOQ (บังคับ)">
          <Textarea name="variance_reason" required />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="วันที่"><Input name="expense_date" type="date" defaultValue={todayISO()} required /></FormField>
        <FormField label="จำนวนเงิน (บาท)"><Input name="amount" type="number" step="0.01" min="0" inputMode="decimal" required /></FormField>
      </div>
      <FormField label="รายละเอียด"><Input name="description" required placeholder="เช่น ค่าน้ำมันรถขนเหล็ก" /></FormField>
      <FormField label="ใบเสร็จ / รูปแนบ"><Input type="file" name="attachment" accept="image/*,.pdf" capture="environment" /></FormField>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !itemId}>{pending ? 'กำลังบันทึก' : 'บันทึกค่าใช้จ่าย'}</Button>
    </form>
  )
}
