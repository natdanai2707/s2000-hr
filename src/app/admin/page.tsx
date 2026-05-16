'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [exportMonth, setExportMonth] = useState(new Date().toISOString().slice(0, 7))
  const [exportType, setExportType] = useState<'daily' | 'monthly'>('daily')
  const [exporting, setExporting] = useState(false)
  const [stats, setStats] = useState({ employees: 0, pendingLeaves: 0, worklogs: 0 })

  const ADMIN_LINE_IDS = [
    'U216ca0ca345ca9a19c299b4a5ac97b23', // Surf
    'a1000000-0000-0000-0000-000000000006', // HR placeholder
  ]

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status])

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    const [empRes, leaveRes, logRes] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact' }).eq('is_active', true),
      supabase.from('leave_requests').select('id', { count: 'exact' }).eq('status', 'pending'),
      supabase.from('work_logs').select('id', { count: 'exact' }).gte('log_date', new Date().toISOString().slice(0, 7) + '-01'),
    ])
    setStats({
      employees: empRes.count || 0,
      pendingLeaves: leaveRes.count || 0,
      worklogs: logRes.count || 0,
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(`/api/export/payroll?month=${exportMonth}&type=${exportType}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payroll_${exportType}_${exportMonth}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export ล้มเหลว กรุณาลองใหม่')
    } finally {
      setExporting(false)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">กำลังโหลด...</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">Admin</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl p-4 border border-gray-100 text-center">
            <p className="text-2xl font-bold text-gray-800">{stats.employees}</p>
            <p className="text-xs text-gray-500 mt-1">พนักงาน</p>
          </div>
          <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100 text-center">
            <p className="text-2xl font-bold text-yellow-700">{stats.pendingLeaves}</p>
            <p className="text-xs text-gray-500 mt-1">รออนุมัติ</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-center">
            <p className="text-2xl font-bold text-blue-700">{stats.worklogs}</p>
            <p className="text-xs text-gray-500 mt-1">Work log เดือนนี้</p>
          </div>
        </div>

        {/* Export Payroll */}
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-3">Export Payroll</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">เดือน</label>
              <input
                type="month"
                value={exportMonth}
                onChange={e => setExportMonth(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">ประเภทพนักงาน</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setExportType('daily')}
                  className={`py-2 rounded-lg text-sm font-medium border transition ${exportType === 'daily' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
                >
                  รายวัน (D-prefix)
                </button>
                <button
                  onClick={() => setExportType('monthly')}
                  className={`py-2 rounded-lg text-sm font-medium border transition ${exportType === 'monthly' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
                >
                  รายเดือน (M-prefix)
                </button>
              </div>
            </div>

            <button
              onClick={handleExport}
              disabled={exporting}
              className="w-full bg-green-600 text-white rounded-xl py-3 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {exporting ? 'กำลัง Export...' : '⬇️ Export Excel'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              ไฟล์จะมี 4 sheet: ตารางจ่าย, สรุปรายบุคคล, บันทึกงาน, Validation Check
            </p>
          </div>
        </div>

        {/* Quick links */}
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-3">จัดการระบบ</h2>
          <div className="space-y-2">
            <a
              href="https://supabase.com/dashboard/project/hhlzmolktnsfmvrugpnf/editor"
              target="_blank"
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
              <span>🗄️ Supabase Database</span>
              <span className="text-gray-400">→</span>
            </a>
            <button
              onClick={() => router.push('/leave')}
              className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
              <span>📋 ดูคำขอลาทั้งหมด</span>
              <span className="text-gray-400">→</span>
            </button>
            <button
                onClick={() => router.push('/admin/sites')}
                className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
                <span>📍 จัดการไซต์งาน</span>
                <span className="text-gray-400">→</span>
            </button>
            <button
              onClick={() => router.push('/admin/payroll-periods')}
              className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
              <span>🔒 จัดการรอบ Payroll</span>
              <span className="text-gray-400">→</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}