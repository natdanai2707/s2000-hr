'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type TabType = 'all' | 'leave' | 'ot' | 'worklog'

export default function RequestsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [tab, setTab] = useState<TabType>('all')
  const [leaves, setLeaves] = useState<any[]>([])
  const [otRequests, setOtRequests] = useState<any[]>([])
  const [workLogs, setWorkLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7))

  useEffect(() => {
    if (session?.user?.employeeId) fetchAll()
  }, [session, filterMonth])

  async function fetchAll() {
    setLoading(true)
    const start = `${filterMonth}-01`
    const end = `${filterMonth}-31`

    const [leavesRes, otRes, logsRes] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('*, leave_type:leave_types(name, code)')
        .eq('employee_id', session!.user.employeeId!)
        .gte('start_date', start)
        .lte('start_date', end)
        .order('created_at', { ascending: false }),
      supabase
        .from('ot_requests')
        .select('*')
        .eq('employee_id', session!.user.employeeId!)
        .gte('request_date', start)
        .lte('request_date', end)
        .order('created_at', { ascending: false }),
      supabase
        .from('work_logs')
        .select('*, project:projects(project_code, project_name)')
        .eq('employee_id', session!.user.employeeId!)
        .gte('log_date', start)
        .lte('log_date', end)
        .order('log_date', { ascending: false }),
    ])

    setLeaves(leavesRes.data || [])
    setOtRequests(otRes.data || [])
    setWorkLogs(logsRes.data || [])
    setLoading(false)
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  const statusLabel: Record<string, string> = {
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    rejected: 'ไม่อนุมัติ',
    cancelled: 'ยกเลิก',
  }

  const tabs = [
    { key: 'all', label: 'ทั้งหมด', count: leaves.length + otRequests.length + workLogs.length },
    { key: 'leave', label: 'การลา', count: leaves.length },
    { key: 'ot', label: 'OT', count: otRequests.length },
    { key: 'worklog', label: 'บันทึกงาน', count: workLogs.length },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">ประวัติคำขอและบันทึก</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Filter เดือน */}
        <input
          type="month"
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
        />

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as TabType)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${tab === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
            >
              {t.label}
              {t.count > 0 && <span className="ml-1 text-gray-400">({t.count})</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : (
          <div className="space-y-2">

            {/* Leave Requests */}
            {(tab === 'all' || tab === 'leave') && leaves.map(req => (
              <div
                key={req.id}
                onClick={() => router.push(`/leave/${req.id}`)}
                className="bg-white rounded-xl p-3 border border-gray-100 cursor-pointer hover:bg-gray-50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">📋</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{req.leave_type?.name}</p>
                      <p className="text-xs text-gray-400">
                        {req.start_date}{req.end_date !== req.start_date ? ` ถึง ${req.end_date}` : ''}
                        {req.total_days > 0 ? ` · ${req.total_days} วัน` : ''}
                        {req.late_minutes > 0 ? ` · สาย ${req.late_minutes} นาที` : ''}
                      </p>
                      {req.cancel_status === 'pending' && (
                        <p className="text-xs text-orange-500 mt-0.5">⏳ รอยกเลิก</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusColor[req.status]}`}>
                    {statusLabel[req.status]}
                  </span>
                </div>
              </div>
            ))}

            {/* OT Requests */}
            {(tab === 'all' || tab === 'ot') && otRequests.map(req => (
              <div
                key={req.id}
                onClick={() => router.push(`/ot/${req.id}`)}
                className="bg-white rounded-xl p-3 border border-gray-100 cursor-pointer hover:bg-gray-50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">⏰</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">OT · {req.request_date}</p>
                      <p className="text-xs text-gray-400">
                        {req.ot_start} - {req.ot_end} · {req.ot_hours} ชม. ({req.multiplier}x = {req.ot_hours_multiplied} ชม.)
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{req.work_description}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusColor[req.status]}`}>
                    {statusLabel[req.status]}
                  </span>
                </div>
              </div>
            ))}

            {/* Work Logs */}
            {(tab === 'all' || tab === 'worklog') && workLogs.map(log => (
              <div
                key={log.id}
                onClick={() => router.push('/worklog/new')}
                className="bg-white rounded-xl p-3 border border-gray-100 cursor-pointer hover:bg-gray-50"
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg">🔧</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-800 line-clamp-1">{log.task_description}</p>
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0 ml-2">บันทึกแล้ว</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {log.log_date}
                      {log.project && ` · ${log.project.project_name}`}
                      {log.hours_spent > 0 && ` · ${log.hours_spent} ชม.`}
                      {log.ot_hours > 0 && ` · OT ${log.ot_hours} ชม.`}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {!loading && leaves.length === 0 && otRequests.length === 0 && workLogs.length === 0 && (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400">
                <p className="text-sm">ไม่มีข้อมูลในเดือนนี้</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}