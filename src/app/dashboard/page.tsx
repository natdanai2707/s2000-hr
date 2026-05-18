'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LeaveRequest } from '@/lib/types'

interface DayData {
  hasWorkLog: boolean
  hasLeave: boolean
  leaveStatus: string | null
  isHoliday: boolean
  holidayName: string | null
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [myRequests, setMyRequests] = useState<LeaveRequest[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [dayData, setDayData] = useState<Record<string, DayData>>({})
  const [calLoading, setCalLoading] = useState(true)

  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session) return
    if (!session?.user?.employeeId) {
      setLoading(false)
      return
    }
    fetchData()
  }, [session])

  useEffect(() => {
    if (!session?.user?.employeeId) return
    fetchCalendarData()
  }, [session, viewYear, viewMonth])

  async function fetchData() {
    setLoading(true)
    const { data: requests } = await supabase
      .from('leave_requests')
      .select('*, leave_type:leave_types(*)')
      .eq('employee_id', session!.user.employeeId!)
      .order('created_at', { ascending: false })
      .limit(5)
    setMyRequests(requests || [])

    if (session?.user?.approverId) {
      const { data: chains } = await supabase
        .from('approval_chains')
        .select('employee_id, level')
        .eq('approver_id', session.user.approverId)
      if (chains && chains.length > 0) {
        const pendingList: LeaveRequest[] = []
        for (const chain of chains) {
          const { data } = await supabase
            .from('leave_requests')
            .select('*, employee:employees(*), leave_type:leave_types(*)')
            .eq('employee_id', chain.employee_id)
            .eq('status', 'pending')
            .eq('current_approval_level', chain.level)
          if (data) pendingList.push(...data)
        }
        setPendingApprovals(pendingList)
      }
    }
    setLoading(false)
  }

  async function fetchCalendarData() {
    setCalLoading(true)
    const startDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate()
    const endDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const [logsRes, leavesRes, holidaysRes] = await Promise.all([
      supabase
        .from('work_logs')
        .select('log_date')
        .eq('employee_id', session!.user.employeeId!)
        .gte('log_date', startDate)
        .lte('log_date', endDate),
      supabase
        .from('leave_requests')
        .select('start_date, end_date, status')
        .eq('employee_id', session!.user.employeeId!)
        .gte('start_date', startDate)
        .lte('end_date', endDate),
      supabase
        .from('holidays')
        .select('date, name')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('is_active', true),
    ])

    const data: Record<string, DayData> = {}

    for (const log of logsRes.data || []) {
      const d = log.log_date
      if (!data[d]) data[d] = emptyDay()
      data[d].hasWorkLog = true
    }

    for (const leave of leavesRes.data || []) {
      const start = new Date(leave.start_date + 'T12:00:00')
      const end = new Date(leave.end_date + 'T12:00:00')
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        if (!data[dateStr]) data[dateStr] = emptyDay()
        data[dateStr].hasLeave = true
        data[dateStr].leaveStatus = leave.status
      }
    }

    for (const h of holidaysRes.data || []) {
      if (!data[h.date]) data[h.date] = emptyDay()
      data[h.date].isHoliday = true
      data[h.date].holidayName = h.name
    }

    setDayData(data)
    setCalLoading(false)
  }

  function emptyDay(): DayData {
    return { hasWorkLog: false, hasLeave: false, leaveStatus: null, isHoliday: false, holidayName: null }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  function getDots(dateStr: string) {
    const d = dayData[dateStr]
    if (!d) return []
    const dots = []
    if (d.isHoliday) dots.push('bg-purple-400')
    if (d.hasLeave) {
      if (d.leaveStatus === 'approved') dots.push('bg-red-500')
      else if (d.leaveStatus === 'pending') dots.push('bg-yellow-400')
    }
    if (d.hasWorkLog) dots.push('bg-green-500')
    return dots
  }

  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const thaiDays = ['อา','จ','อ','พ','พฤ','ศ','ส']

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const statusLabel: Record<string, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' }
  const statusColor: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', cancelled: 'bg-gray-100 text-gray-600' }

  if (status === 'loading' || loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-500">กำลังโหลด...</p></div>
  }

  if (!session?.user?.employeeId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-2">บัญชี Line ของคุณยังไม่ได้ผูกกับระบบ</p>
          <p className="text-sm text-gray-400 mb-4">กรุณาติดต่อ HR เพื่อลงทะเบียน</p>
          <p className="text-xs text-gray-400">Line ID ของคุณ:</p>
          <p className="text-sm font-mono bg-gray-100 px-3 py-2 rounded mt-1 select-all">{session?.user?.lineUserId}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-800">S-2000</h1>
          <p className="text-xs text-gray-500">{session.user.employeeName} · {session.user.position}</p>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-xs text-gray-400">ออกจากระบบ</button>
      </div>

      <div className="max-w-lg mx-auto px-3 py-3 space-y-4">

        {/* ปฏิทิน */}
        <div className="bg-white rounded-2xl p-3 shadow-sm">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2 px-1">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 text-lg leading-none">‹</button>
            <span className="font-semibold text-gray-800 text-sm">{thaiMonths[viewMonth]} {viewYear + 543}</span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 text-lg leading-none">›</button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {thaiDays.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-400'}`}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          {calLoading ? (
            <div className="h-48 flex items-center justify-center"><p className="text-gray-300 text-sm">กำลังโหลด...</p></div>
          ) : (
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, idx) => {
                if (!day) return <div key={idx} />
                const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const isToday = dateStr === todayStr
                const isSunday = idx % 7 === 0
                const isSaturday = idx % 7 === 6
                const d = dayData[dateStr]
                const isHoliday = d?.isHoliday
                const dots = getDots(dateStr)

                return (
                  <button
                    key={idx}
                    onClick={() => router.push(`/calendar/${dateStr}`)}
                    className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition
                      ${isToday ? 'bg-blue-600 text-white' : isHoliday ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-100'}
                      ${isSunday && !isToday && !isHoliday ? 'text-red-500' : isSaturday && !isToday && !isHoliday ? 'text-blue-500' : !isToday && !isHoliday ? 'text-gray-700' : ''}
                    `}
                  >
                    <span className="text-sm font-medium leading-none">{day}</span>
                    {dots.length > 0 && (
                      <div className="flex gap-0.5 mt-1">
                        {dots.slice(0, 3).map((color, i) => (
                          <div key={i} className={`w-1.5 h-1.5 rounded-full ${color} ${isToday ? 'opacity-80' : ''}`} />
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
            {[
              { color: 'bg-green-500', label: 'บันทึกงานแล้ว' },
              { color: 'bg-red-500', label: 'ลา (อนุมัติ)' },
              { color: 'bg-yellow-400', label: 'ลา (รออนุมัติ)' },
              { color: 'bg-purple-400', label: 'วันหยุด' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full shrink-0 ${item.color}`} />
                <span className="text-xs text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Approvals */}
        {pendingApprovals.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">รออนุมัติจากคุณ ({pendingApprovals.length})</h2>
            <div className="space-y-2">
              {pendingApprovals.map((req) => (
                <div key={req.id} onClick={() => router.push(`/approve/${req.id}`)} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 cursor-pointer hover:bg-yellow-100 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{(req as any).employee?.name}</p>
                      <p className="text-xs text-gray-500">{(req as any).leave_type?.name} · {req.total_days} วัน · {req.start_date}</p>
                    </div>
                    <span className="text-yellow-600 text-xs">อนุมัติ →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => router.push('/leave/new')} className="bg-[#06C755] text-white rounded-xl p-3 text-left">
            <div className="text-xl mb-1">📋</div>
            <div className="font-medium text-xs">ยื่นคำขอลา</div>
            <div className="text-xs opacity-70 mt-0.5">ลา/มาสาย/ขาด</div>
          </button>
          <button onClick={() => router.push('/worklog/new')} className="bg-blue-600 text-white rounded-xl p-3 text-left">
            <div className="text-xl mb-1">🔧</div>
            <div className="font-medium text-xs">บันทึกงาน</div>
            <div className="text-xs opacity-70 mt-0.5">รายงานการปฏิบัติงาน</div>
          </button>
          <button onClick={() => router.push('/attendance')} className="bg-orange-500 text-white rounded-xl p-3 text-left">
            <div className="text-xl mb-1">📍</div>
            <div className="font-medium text-xs">เช็คอิน/เอาท์</div>
            <div className="text-xs opacity-70 mt-0.5">พนักงานประจำไซต์</div>
          </button>
          <button onClick={() => router.push('/ot/new')} className="bg-yellow-500 text-white rounded-xl p-3 text-left">
            <div className="text-xl mb-1">⏰</div>
            <div className="font-medium text-xs">ขอทำ OT</div>
            <div className="text-xs opacity-70 mt-0.5">ยื่นขออนุมัติ OT</div>
          </button>
          <button onClick={() => router.push('/requests')} className="bg-gray-600 text-white rounded-xl p-3 text-left">
            <div className="text-xl mb-1">📜</div>
            <div className="font-medium text-xs">ประวัติคำขอ</div>
            <div className="text-xs opacity-70 mt-0.5">ลา / OT / บันทึกงาน</div>
          </button>
        </div>

        {/* My Leave Requests */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">คำขอลาของฉัน</h2>
            <button onClick={() => router.push('/leave')} className="text-xs text-blue-500">ดูทั้งหมด</button>
          </div>
          {myRequests.length === 0 ? (
            <div className="bg-white rounded-xl p-4 text-center text-gray-400 text-sm">ยังไม่มีคำขอลา</div>
          ) : (
            <div className="space-y-2">
              {myRequests.map((req) => (
                <div key={req.id} onClick={() => router.push(`/approve/${req.id}`)} className="bg-white rounded-xl p-3 cursor-pointer hover:bg-gray-50 transition border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{(req as any).leave_type?.name}</p>
                      <p className="text-xs text-gray-500">{req.start_date}{req.end_date !== req.start_date ? ` ถึง ${req.end_date}` : ''} · {req.total_days} วัน</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${statusColor[req.status]}`}>{statusLabel[req.status]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin */}
        {session.user.isAdmin && (
          <button onClick={() => router.push('/admin')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2">
            ⚙️ จัดการระบบ (Admin)
          </button>
        )}
      </div>
    </div>
  )
}