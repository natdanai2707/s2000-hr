'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startBoqRevision } from '@/actions/boq'
import { Button } from '@/components/ui/button'

// แก้ BOQ ที่ยืนยันแล้วโดยไม่ต้องอัปโหลดไฟล์ ระบบเปิดร่าง VO ให้แล้วพาไปหน้าแก้รายการ
export function EditBoqButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function go() {
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
