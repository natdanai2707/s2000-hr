'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function CalendarDayPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const dateStr = params.date as string

  const [workLogs, setWorkLogs] = useState<any[]>([])
  const [leaveRequest, setLeaveRequest] = useState<any | null>(null)
  const [holiday, setHoliday] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (session?.user?.employeeId && dateStr) fetchDayData()
  }, [session, dateStr])

  async function fetchDayData() {
    setLoading(true)
    const [logsRes, leavesRes, holidayRes] = await Promise.all([
      supabase
        .from('work_logs')
        .select('*, project:projects(project_code, project_name)')
        .eq('employee_id', session!.user.employeeId!)
        .eq('log_date', dateStr)
        .order('created_at'),
      supabase
        .from('leave_requests')
        .select('*, leave_type:leave_types(name, code)')
        .eq('employee_id', session!.user.employeeId!)
        .lte('start_date', dateStr)
        .gte('end_date', dateStr)
        .neq('status', 'cancelled')
        .limit(1)
        .single(),
      supabase
        .from('holidays')
        .select('*')
        .eq('date', dateStr)
        .eq('is_active', true)
        .single(),
    ])

    setWorkLogs(logsRes.data || [])
    setLeaveRequest(leavesRes.data || null)
    setHoliday(holidayRes.data || null)
    setLoading(false)
  }

  const dateObj = new Date(dateStr + 'T12:00:00')
  const displayDate = dateObj.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const todayStr = new Date().toISOString().split('T')[0]
  const isPastOrToday = dateStr <= todayStr

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    approved: 'bg-red-50 border-red-200 text-red-800',
    rejected: 'bg-gray-50 border-gray-200 text-gray-600',
  }
  const statusLabel: Record<string, string> = {
    pending: '⏳ รออนุมัติ',
    approved: '✅ อนุมัติแล้ว',
    rejected: '❌ ไม่อนุมัติ',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <div>
          <h1 className="font-semibold text-gray-800">{displayDate}</h1>
          {holiday && <p className="text-xs text-purple-600">🎌 {holiday.name}</p>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><p className="text-gray-400">กำลังโหลด...</p></div>
      ) : (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

          {/* การลา */}
          {leaveRequest && (
            <div className={`rounded-xl p-4 border ${statusColor[leaveRequest.status]}`}>
              <p className="text-sm font-semibold mb-1">การลา</p>
              <p className="text-sm">{leaveRequest.leave_type?.name}</p>
              {leaveRequest.late_minutes > 0 && <p className="text-xs mt-0.5">สาย {leaveRequest.late_minutes} นาที</p>}
              <p className="text-xs mt-1">{statusLabel[leaveRequest.status]}</p>
            </div>
          )}

          {/* Work Logs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">
                บันทึกการปฏิบัติงาน {workLogs.length > 0 && `(${workLogs.length} รายการ)`}
              </p>
              {isPastOrToday && (
                <button
                  onClick={() => router.push('/worklog/new')}
                  className="text-xs text-blue-500"
                >
                  + เพิ่ม
                </button>
              )}
            </div>

            {workLogs.length === 0 ? (
              <div className="bg-white rounded-xl p-4 border border-gray-100 text-center">
                {isPastOrToday ? (
                  <>
                    <p className="text-sm text-gray-400 mb-2">ยังไม่มีบันทึกการปฏิบัติงาน</p>
                    <button
                      onClick={() => router.push('/worklog/new')}
                      className="text-sm text-blue-500 underline"
                    >
                      + บันทึกการปฏิบัติงาน
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">ยังไม่ถึงวันนี้</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {workLogs.map((log: any) => (
                  <div key={log.id} className="bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{log.task_description}</p>
                        {log.site_location && <p className="text-xs text-gray-400 mt-0.5">📍 {log.site_location}</p>}
                        {log.project && <p className="text-xs text-gray-400">{log.project.project_name}</p>}
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {log.hours_spent > 0 && <span className="text-xs text-blue-600">{log.hours_spent} ชม.</span>}
                          {log.ot_hours > 0 && <span className="text-xs text-orange-500">OT {log.ot_hours} ชม.</span>}
                          {log.water_allowance > 0 && <span className="text-xs text-cyan-600">น้ำ {log.water_allowance} บ.</span>}
                          {log.daily_allowance > 0 && <span className="text-xs text-green-600">เบี้ย {log.daily_allowance} บ.</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => router.push('/worklog/new')}
                        className="text-xs text-blue-500 ml-2 shrink-0"
                      >
                        แก้ไข
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ยื่นคำขอลา */}
          {!leaveRequest && !holiday && (
            <button
              onClick={() => router.push('/leave/new')}
              className="w-full border border-[#06C755] text-[#06C755] rounded-xl py-3 font-medium text-sm hover:bg-green-50 transition"
            >
              📋 ยื่นคำขอลาสำหรับวันนี้
            </button>
          )}

          {holiday && !leaveRequest && workLogs.length === 0 && (
            <div className="bg-purple-50 rounded-xl p-4 text-center">
              <p className="text-purple-700 text-sm">🎌 วันหยุด: {holiday.name}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}