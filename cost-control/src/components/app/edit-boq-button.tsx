'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startBoqRevision } from '@/actions/boq'
import { Button } from '@/components/ui/button'

// แก้ BOQ ที่ยืนยันแล้วโดยไม่ต้องอัปโหลดไฟล์ ระบบเปิดร่าง VO ให้แล้วพาไปหน้าแก้รายการ
// ฝ่ายบริหารแก้เวอร์ชันที่ยืนยันแล้วได้ตรงๆ จึงพาไปหน้าเวอร์ชันนั้นเลย ไม่ต้องเปิดร่าง
export function EditBoqButton({ projectId, confirmedVersionId }: { projectId: string; confirmedVersionId?: string | null }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function go() {
    if (confirmedVersionId) {
      router.push(`/projects/${projectId}/boq/${confirmedVersionId}`)
      return
    }
    setPending(true)
    const res = await startBoqRevision(projectId)
    setPending(false)
    if (!res.ok) {
      alert(res.error)
      return
    }
    router.push(`/projects/${projectId}/boq/${res.data.version_id}`)
    router.refresh()
  }

  return (
    <Button variant="outline" onClick={go} disabled={pending}>
      {pending ? 'กำลังเปิด' : 'แก้ไข BOQ'}
    </Button>
  )
}
