'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmBoqVersion, createVariationOrder } from '@/actions/boq'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

export function BoqVersionActions({
  projectId,
  versionId,
  status,
  canConfirm,
  canCreateVo,
  hasItems,
}: {
  projectId: string
  versionId: string
  status: string
  canConfirm: boolean
  canCreateVo: boolean
  hasItems: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [voOpen, setVoOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function confirm() {
    setPending(true)
    setError(null)
    const res = await confirmBoqVersion(versionId, projectId)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  async function createVo() {
    setPending(true)
    setError(null)
    const res = await createVariationOrder(projectId, note)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setVoOpen(false)
    router.push(`/projects/${projectId}/boq/${res.data.version_id}`)
    router.refresh()
  }

  return (
    <>
      {canConfirm && (
        <Button onClick={() => setOpen(true)} disabled={!hasItems}>
          ยืนยัน BOQ
        </Button>
      )}
      {canCreateVo && (
        <Button variant="outline" onClick={() => setVoOpen(true)}>
          สร้าง VO
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยัน BOQ เวอร์ชันนี้</DialogTitle>
            <DialogDescription>
              เมื่อยืนยันแล้ว งบจะถูกล็อก แก้ไขตัวเลขไม่ได้ ต้องทำเป็น VO เท่านั้น {status === 'draft' ? 'เวอร์ชันที่ยืนยันอยู่ก่อนหน้า (ถ้ามี) จะเปลี่ยนเป็นถูกแทนที่ และโครงการจะเข้าสถานะกำลังดำเนินการ' : ''}
            </DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>ยกเลิก</Button>
            <Button onClick={confirm} disabled={pending}>{pending ? 'กำลังยืนยัน' : 'ยืนยัน'}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={voOpen} onOpenChange={setVoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้าง VO</DialogTitle>
            <DialogDescription>ระบบจะสร้างเวอร์ชันใหม่โดย copy รายการทั้งหมดจากเวอร์ชันนี้ แล้วให้แก้ไขเฉพาะรายการที่เปลี่ยน</DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <Input placeholder="หมายเหตุ เช่น ลูกค้าเพิ่มงานหลังคา" value={note} onChange={e => setNote(e.target.value)} className="mb-3" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoOpen(false)} disabled={pending}>ยกเลิก</Button>
            <Button onClick={createVo} disabled={pending}>{pending ? 'กำลังสร้าง' : 'สร้าง VO'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
