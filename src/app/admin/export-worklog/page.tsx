'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, Button } from '@/components/ui'
import { currentMonthISO, formatThaiDate } from '@/lib/date'

interface Emp { id: string; name: string; employee_code: string }

export default function ExportWorklogPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonthISO())
  const [employeeId, setEmployeeId] = useState('all')
  const [employees, setEmployees] = useState<Emp[]>([])
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) { router.replace('/dashboard'); return }
    fetchEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status])

  async function fetchEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, name, employee_code')
      .eq('is_active', true)
      .order('employee_code')
    setEmployees((data || []) as Emp[])
  }

  async function handleDownload() {
    setDownloading(true)
    setError('')
    try {
      const url = `/api/export/worklog?month=${month}&employeeId=${employeeId}`
      const res = await fetch(url)
      if (!res.ok) {
        let msg = 'ออกไฟล์ไม่สำเร็จ กรุณาลองใหม่'
        if (res.status === 404) msg = 'ไม่พบพนักงาน/ข้อมูลในเดือนที่เลือก'
        else if (res.status === 403) msg = 'ไม่มีสิทธิ์ (เฉพาะ HR/Admin)'
        throw new Error(msg)
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      const objUrl = URL.createObjectURL(blob)
      a.href = objUrl
      a.download = `worklog_${employeeId === 'all' ? 'all' : employeeId}_${month}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e: any) {
      console.error('export worklog error:', e)
      setError(e?.message || 'ออกไฟล์ไม่สำเร็จ')
    } finally {
      setDownloading(false)
    }
  }

  if (status === 'loading' || !session?.user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p></div>
  }

  const monthLabel = formatThaiDate(`${month}-01`, { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ใบปฏิบัติงาน (Excel)" subtitle="รายวัน แยกรายคน" onBack={() => router.push('/admin')} />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เดือน</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">พนักงาน</label>
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800 bg-white"
            >
              <option value="all">ทุกคน (แยกชีตต่อคน)</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.employee_code} · {e.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-xs text-gray-500">
            คอลัมน์: วันที่ · วัน · เลข Job · ชื่องาน · รายละเอียด · สถานที่ · เวลาทำงาน · OT · ค่าน้ำ · เบี้ยเลี้ยง · เงินได้อื่นๆ · สาย/ลา/ขาด
            <br />รอบ: {monthLabel}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <Button variant="primary" fullWidth onClick={handleDownload} disabled={downloading} className="py-3">
            {downloading ? 'กำลังสร้างไฟล์...' : '📥 ดาวน์โหลดใบปฏิบัติงาน'}
          </Button>
        </div>
      </div>
    </div>
  )
}
