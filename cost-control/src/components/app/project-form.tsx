'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProject, updateProject } from '@/actions/projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'
import type { Branch, Project, ProjectStatus } from '@/lib/types'
import { PROJECT_STATUS_LABELS } from '@/lib/types'
import { DateInput } from './date-input'

export function ProjectForm({ branches, project }: { branches: Branch[]; project?: Project }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = project ? await updateProject(project.id, fd) : await createProject(fd)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (project) router.push(`/projects/${project.id}`)
    else if (res.data) router.push(`/projects/${(res.data as { id: string }).id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="รหัสโครงการ">
          <Input name="code" required defaultValue={project?.code} disabled={!!project} placeholder="เช่น PJ-2569-001" />
        </FormField>
        <FormField label="สาขา">
          <Select name="branch_id" required defaultValue={project?.branch_id ?? ''}>
            <option value="" disabled>เลือกสาขา</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="ชื่อโครงการ">
        <Input name="name" required defaultValue={project?.name} />
      </FormField>
      <FormField label="ลูกค้า">
        <Input name="customer_name" defaultValue={project?.customer_name ?? ''} />
      </FormField>
      {project && (
        <FormField label="สถานะโครงการ" hint="เปลี่ยนเป็นปิดแล้วเมื่อจบงาน โครงการที่ปิดจะไม่แสดงบนแดชบอร์ด">
          <Select name="status" defaultValue={project.status}>
            {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map(k => (
              <option key={k} value={k}>{PROJECT_STATUS_LABELS[k]}</option>
            ))}
          </Select>
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* ตอนสร้างโครงการไม่ต้องกรอก ระบบอ่านมูลค่าสัญญาจากไฟล์ BOQ ตอนนำเข้า แก้ภายหลังได้ที่หน้านี้ */}
        {project ? (
          <FormField label="มูลค่าสัญญา (ไม่รวม VAT)" hint="ใช้คำนวณกำไรเทียบกับต้นทุนใน BOQ ซึ่งไม่รวม VAT">
            <Input name="contract_value" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={project.contract_value ?? ''} />
          </FormField>
        ) : (
          <div className="text-sm">
            <div className="font-medium">มูลค่าสัญญา</div>
            <p className="text-xs text-muted-foreground mt-1">ไม่ต้องกรอก ระบบอ่านจากไฟล์ BOQ ตอนนำเข้า และให้ตรวจก่อนบันทึก แก้ภายหลังได้ที่หน้าแก้ไขโครงการ</p>
          </div>
        )}
        <FormField label="เงินประกันผลงาน (%)">
          <Input name="retention_pct" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={project?.retention_pct ?? 0} />
        </FormField>
        <FormField label="วันเริ่มงาน">
          <DateInput name="start_date" defaultValue={project?.start_date ?? ''} />
        </FormField>
        <FormField label="กำหนดเสร็จ">
          <DateInput name="planned_end_date" defaultValue={project?.planned_end_date ?? ''} />
        </FormField>
        <FormField label="ค่าปรับต่อวัน (บาท)">
          <Input name="penalty_per_day" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={project?.penalty_per_day ?? 0} />
        </FormField>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>ยกเลิก</Button>
        <Button type="submit" disabled={pending}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
      </div>
    </form>
  )
}
