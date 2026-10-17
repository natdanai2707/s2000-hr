'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmBoqVersion, unconfirmBoqVersion, deleteBoqVersion, createVariationOrder } from '@/actions/boq'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

type Kind = 'confirm' | 'unconfirm' | 'delete' | 'vo'

export function BoqVersionActions({
  projectId,
  versionId,
  canConfirm,
  canUnconfirm,
  canDelete,
  canCreateVo,
  hasItems,
}: {
  projectId: string
  versionId: string
  status: string
  canConfirm: boolean
  canUnconfirm: boolean
  canDelete: boolean
  canCreateVo: boolean
  hasItems: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<Kind | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function close() {
    setOpen(null)
    setError(null)
  }

  async function run(kind: Kind) {
    setPending(true)
    setError(null)
    const res =
      kind === 'confirm'
        ? await confirmBoqVersion(versionId, projectId)
        : kind === 'unconfirm'
          ? await unconfirmBoqVersion(versionId, projectId)
          : kind === 'delete'
            ? await deleteBoqVersion(versionId, projectId)
            : await createVariationOrder(projectId, note)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    close()
    if (kind === 'delete') {
      router.push(`/projects/${projectId}`)
    } else if (kind === 'vo') {
      router.push(`/projects/${projectId}/boq/${(res.data as { version_id: string }).version_id}`)
    }
    router.refresh()
  }

  return (
    <>
      {canConfirm && (
        <Button onClick={() => setOpen('confirm')} disabled={!hasItems}>
          ยืนยัน BOQ
        </Button>
      )}
      {canUnconfirm && (
        <Button variant="outline" onClick={() => setOpen('unconfirm')}>
          ยกเลิกการยืนยัน
        </Button>
      )}
      {canCreateVo && (
        <Button variant="outline" onClick={() => setOpen('vo')}>
          สร้าง VO
        </Button>
      )}
      {canDelete && (
        <Button variant="destructive" onClick={() => setOpen('delete')}>
          ลบเวอร์ชันนี้
        </Button>
      )}

      <Dialog open={open === 'confirm'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยัน BOQ เวอร์ชันนี้</DialogTitle>
            <DialogDescription>
              เมื่อยืนยันแล้ว เวอร์ชันนี้เป็นงบที่ใช้เทียบต้นทุน เวอร์ชันที่ยืนยันอยู่ก่อนหน้า (ถ้ามี) จะเปลี่ยนเป็นถูกแทนที่
              และโครงการจะเข้าสถานะกำลังดำเนินการ ฝ่ายบริหารยังแก้ปริมาณ ราคา และเพิ่มลบรายการได้ตลอด
              ทุกการแก้ไขถูกบันทึกในประวัติพร้อมค่าเดิมและค่าใหม่
            </DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>ยกเลิก</Button>
            <Button onClick={() => run('confirm')} disabled={pending}>{pending ? 'กำลังยืนยัน' : 'ยืนยัน'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'unconfirm'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยกเลิกการยืนยัน BOQ</DialogTitle>
            <DialogDescription>
              เวอร์ชันนี้จะกลับไปเป็นร่าง แก้ตัวเลขได้ตามปกติ ถ้าโครงการไม่เหลือ BOQ ที่ยืนยันแล้ว
              โครงการจะกลับไปเป็นร่างด้วยและหายจากแดชบอร์ดจนกว่าจะยืนยันใหม่
              ทำได้เฉพาะตอนที่โครงการยังไม่มีใบขอซื้อ ใบสั่งซื้อ ใบแจ้งหนี้ ค่าใช้จ่าย หรือสัญญาผู้รับเหมาช่วง
            </DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>ปิด</Button>
            <Button onClick={() => run('unconfirm')} disabled={pending}>{pending ? 'กำลังดำเนินการ' : 'ยกเลิกการยืนยัน'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'delete'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบ BOQ เวอร์ชันนี้</DialogTitle>
            <DialogDescription>
              ลบทั้งเวอร์ชันพร้อมหมวดและรายการทั้งหมด ย้อนกลับไม่ได้ ต้องนำเข้าไฟล์ใหม่
              ทำได้เฉพาะตอนที่โครงการยังไม่มีเอกสารต้นทุนผูกอยู่
            </DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>ยกเลิก</Button>
            <Button variant="destructive" onClick={() => run('delete')} disabled={pending}>
              {pending ? 'กำลังลบ' : 'ลบเวอร์ชันนี้'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'vo'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้าง VO</DialogTitle>
            <DialogDescription>ระบบจะสร้างเวอร์ชันใหม่โดย copy รายการทั้งหมดจากเวอร์ชันนี้ แล้วให้แก้ไขเฉพาะรายการที่เปลี่ยน</DialogDescription>
          </DialogHeader>
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <Input placeholder="หมายเหตุ เช่น ลูกค้าเพิ่มงานหลังคา" value={note} onChange={e => setNote(e.target.value)} className="mb-3" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>ยกเลิก</Button>
            <Button onClick={() => run('vo')} disabled={pending}>{pending ? 'กำลังสร้าง' : 'สร้าง VO'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
