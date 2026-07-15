'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { PageHeader, Button } from '@/components/ui'
import { currentMonthISO, formatThaiDate } from '@/lib/date'

export default function ExportPayrollPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonthISO())
  const [type, setType] = useState<'daily' | 'monthly'>('daily')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  // guard: เฉพาะ admin เท่านั้น
  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) router.replace('/dashboard')
  }, [session, status, router])

  async function handleDownload() {
    setDownloading(true)
    setError('')
    try {
      const url = `/api/export/payroll?month=${month}&type=${type}`
      const res = await fetch(url)
      if (!res.ok) {
        // route ตอบเป็น JSON error
        let msg = 'ออกไฟล์ไม่สำเร็จ กรุณาลองใหม่'
        try {
          const j = await res.json()
          if (res.status === 404) msg = 'ไม่พบพนักงานประเภทนี้ในเดือนที่เลือก'
          else if (res.status === 401 || res.status === 403) msg = 'ไม่มีสิทธิ์ออกรายงาน (เฉพาะ HR/Admin)'
          else if (j?.error) msg = `ออกไฟล์ไม่สำเร็จ: ${j.error}`
        } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      const objUrl = URL.createObjectURL(blob)
      a.href = objUrl
      a.download = `payroll_${type}_${month}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e: any) {
      console.error('export error:', e)
      setError(e?.message || 'ออกไฟล์ไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setDownloading(false)
    }
  }

  if (status === 'loading' || !session?.user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    )
  }

  const monthLabel = formatThaiDate(`${month}-01`, { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ออก Payroll (Excel)" subtitle="สรุปเงินเดือน/ค่าแรง 4 ชีต" onBack={() => router.push('/admin')} />

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
            <label className="block text-sm font-medium text-gray-700 mb-2">ประเภทพนักงาน</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'daily', label: 'รายวัน', sub: 'ค่าแรง × วันทำงาน' },
                { key: 'monthly', label: 'รายเดือน', sub: 'เงินเดือนประจำ' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setType(opt.key)}
                  className={`rounded-xl p-3 border text-left min-h-16 transition ${
                    type === opt.key ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <p className="font-medium text-gray-800 text-sm">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-xs text-gray-500">
            ไฟล์จะรวม 4 ชีต: ตารางจ่าย (มีสูตร), สรุปรายบุคคล, บันทึกงาน, ตรวจสอบความถูกต้อง
            <br />รอบ: {monthLabel} · {type === 'daily' ? 'รายวัน' : 'รายเดือน'}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <Button variant="primary" fullWidth onClick={handleDownload} disabled={downloading} className="py-3">
            {downloading ? 'กำลังสร้างไฟล์...' : '📥 ดาวน์โหลด Excel'}
          </Button>
        </div>

        <p className="text-xs text-gray-400 text-center px-4">
          หมายเหตุ: ยอด ปกส. คิด 3% สูงสุด 750 บาท และตัวคูณ OT เป็นไปตาม พ.ร.บ.คุ้มครองแรงงาน
        </p>
      </div>
    </div>
  )
}
