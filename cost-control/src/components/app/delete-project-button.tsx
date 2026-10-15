'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteProject, getProjectDeleteBlockers, type ProjectDeleteBlocker } from '@/actions/projects'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'

export function DeleteProjectButton({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [blockers, setBlockers] = useState<ProjectDeleteBlocker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function openDialog() {
    setOpen(true)
    setError(null)
    setCode('')
    setBlockers(null)
    const res = await getProjectDeleteBlockers(projectId)
    if (res.ok) setBlockers(res.data)
  }

  async function remove() {
    setPending(true)
    setError(null)
    const res = await deleteProject(projectId, code)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.push('/projects')
    router.refresh()
  }

  const blocked = blockers !== null && blockers.length > 0

  return (
    <>
      <Button variant="destructive" onClick={openDialog}>
        ลบโครงการ
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบโครงการ {projectCode}</DialogTitle>
            <DialogDescription>
              ลบโครงการพร้อม BOQ ทุกเวอร์ชันและรายชื่อสมาชิก ย้อนกลับไม่ได้
            </DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          {blocked ? (
            <>
              <Alert tone="warning" className="mb-3">
                ลบไม่ได้ โครงการนี้มีเอกสารต้นทุนผูกอยู่แล้ว ได้แก่{' '}
                {blockers!.map(b => `${b.label} ${b.count} รายการ`).join(' · ')}
                {'  '}
                เอกสารเหล่านี้เป็นบันทึกทางการเงินที่มีประวัติการแก้ไขผูกอยู่ ถ้าต้องการเลิกใช้โครงการ ให้เปลี่ยนสถานะเป็นปิดแทนการลบ
              </Alert>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setOpen(false)}>ปิด</Button>
              </div>
            </>
          ) : (
            <>
              <FormField label={`พิมพ์รหัสโครงการ ${projectCode} เพื่อยืนยัน`}>
                <Input value={code} onChange={e => setCode(e.target.value)} placeholder={projectCode} autoComplete="off" />
              </FormField>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>ยกเลิก</Button>
                <Button variant="destructive" onClick={remove} disabled={pending || code.trim() !== projectCode}>
                  {pending ? 'กำลังลบ' : 'ลบโครงการ'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
