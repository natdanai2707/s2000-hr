'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { todayISO, monthRange, eachDateInclusive, formatThaiDate } from '@/lib/date'

interface DayData {
  hasWorkLog: boolean
  hasLeave: boolean
  leaveStatus: string | null
  leaveTypeName: string | null
  isHoliday: boolean
  holidayName: string | null
  workLogs: any[]
  leaveRequest: any | null
}

export default function CalendarPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [dayData, setDayData] = useState<Record<string, DayData>>({})
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<DayData | null>(null)
  const [showDayModal, setShowDayModal] = useState(false)

  useEffect(() => {
    if (session?.user?.employeeId) fetchMonthData()
  }, [session, viewYear, viewMonth])

  async function fetchMonthData() {
    setLoading(true)
    const ym = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
    const { start: startDate, end: endDate } = monthRange(ym)

    const [logsRes, leavesRes, holidaysRes] = await Promise.all([
      supabase
        .from('work_logs')
        .select('*, project:projects(project_code, project_name)')
        .eq('employee_id', session!.user.employeeId!)
        .gte('log_date', startDate)
        .lte('log_date', endDate),
      supabase
        .from('leave_requests')
        .select('*, leave_type:leave_types(name, code)')
        .eq('employee_id', session!.user.employeeId!)
        .gte('start_date', startDate)
        .lte('end_date', endDate),
      supabase
        .from('holidays')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('is_active', true),
    ])

    const data: Record<string, DayData> = {}

    // work logs
    for (const log of logsRes.data || []) {
      if (!data[log.log_date]) data[log.log_date] = emptyDay()
      data[log.log_date].hasWorkLog = true
      data[log.log_date].workLogs.push(log)
    }

    // leave requests
    for (const leave of leavesRes.data || []) {
      for (const dateStr of eachDateInclusive(leave.start_date, leave.end_date)) {
        if (!data[dateStr]) data[dateStr] = emptyDay()
        data[dateStr].hasLeave = true
        data[dateStr].leaveStatus = leave.status
        data[dateStr].leaveTypeName = leave.leave_type?.name || null
        data[dateStr].leaveRequest = leave
      }
    }

    // holidays
    for (const h of holidaysRes.data || []) {
      if (!data[h.date]) data[h.date] = emptyDay()
      data[h.date].isHoliday = true
      data[h.date].holidayName = h.name
    }

    setDayData(data)
    setLoading(false)
  }

  function emptyDay(): DayData {
    return {
      hasWorkLog: false,
      hasLeave: false,
      leaveStatus: null,
      leaveTypeName: null,
      isHoliday: false,
      holidayName: null,
      workLogs: [],
      leaveRequest: null,
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  function handleDayClick(dateStr: string) {
    setSelectedDate(dateStr)
    setSelectedData(dayData[dateStr] || emptyDay())
    setShowDayModal(true)
  }

  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const todayStr = todayISO()

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function getDotColors(dateStr: string) {
    const d = dayData[dateStr]
    if (!d) return []
    const dots = []
    if (d.isHoliday) dots.push('bg-purple-400')
    if (d.hasLeave) {
      if (d.leaveStatus === 'approved') dots.push('bg-red-500')
      else if (d.leaveStatus === 'pending') dots.push('bg-yellow-400')
      else if (d.leaveStatus === 'rejected') dots.push('bg-gray-400')
    }
    if (d.hasWorkLog) dots.push('bg-green-500')
    return dots
  }

  if (showDayModal && selectedDate && selectedData) {
    const displayDate = formatThaiDate(selectedDate, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const isPast = selectedDate < todayStr
    const isToday = selectedDate === todayStr

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
          <button onClick={() => setShowDayModal(false)} className="text-gray-400">←</button>
          <div>
            <h1 className="font-semibold text-gray-800">{displayDate}</h1>
            {selectedData.isHoliday && (
              <p className="text-xs text-purple-600">🎌 {selectedData.holidayName}</p>
            )}
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

          {/* สถานะการลา */}
          {selectedData.hasLeave && selectedData.leaveRequest && (
            <div className={`rounded-xl p-4 border ${
              selectedData.leaveStatus === 'approved' ? 'bg-red-50 border-red-200' :
              selectedData.leaveStatus === 'pending' ? 'bg-yellow-50 border-yellow-200' :
              'bg-gray-50 border-gray-200'
            }`}>
              <p className="text-sm font-semibold text-gray-700 mb-1">การลา</p>
              <p className="text-sm text-gray-800">{selectedData.leaveTypeName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedData.leaveStatus === 'approved' ? '✅ อนุมัติแล้ว' :
                 selectedData.leaveStatus === 'pending' ? '⏳ รออนุมัติ' : '❌ ไม่อนุมัติ'}
              </p>
            </div>
          )}

          {/* Work Logs */}
          {selectedData.workLogs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700">บันทึกการปฏิบัติงาน</p>
                <button
                  onClick={() => {
                    setShowDayModal(false)
                    router.push('/worklog/new')
                  }}
                  className="text-xs text-blue-500"
                >
                  + เพิ่มรายการ
                </button>
              </div>
              <div className="space-y-2">
                {selectedData.workLogs.map((log: any) => (
                  <div key={log.id} className="bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{log.task_description}</p>
                        {log.site_location && <p className="text-xs text-gray-400">📍 {log.site_location}</p>}
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {log.hours_spent > 0 && <span className="text-xs text-blue-600">{log.hours_spent} ชม.</span>}
                          {log.ot_hours > 0 && <span className="text-xs text-orange-500">OT {log.ot_hours} ชม.</span>}
                          {log.water_allowance > 0 && <span className="text-xs text-cyan-600">น้ำ {log.water_allowance} บ.</span>}
                          {log.daily_allowance > 0 && <span className="text-xs text-green-600">เบี้ย {log.daily_allowance} บ.</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setShowDayModal(false)
                          router.push('/worklog/new')
                        }}
                        className="text-xs text-blue-500 ml-2 shrink-0"
                      >
                        แก้ไข
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ยังไม่มี work log */}
          {!selectedData.hasWorkLog && (isPast || isToday) && !selectedData.isHoliday && (
            <div className="bg-white rounded-xl p-4 border border-gray-100 text-center">
              <p className="text-sm text-gray-400 mb-2">ยังไม่มีบันทึกการปฏิบัติงาน</p>
              <button
                onClick={() => {
                  setShowDayModal(false)
                  router.push('/worklog/new')
                }}
                className="text-sm text-blue-500 underline"
              >
                + บันทึกการปฏิบัติงาน
              </button>
            </div>
          )}

          {/* ปุ่มยื่นคำขอลา */}
          {!selectedData.hasLeave && !selectedData.isHoliday && (
            <button
              onClick={() => {
                setShowDayModal(false)
                router.push('/leave/new')
              }}
              className="w-full border border-[#06C755] text-[#06C755] rounded-xl py-3 font-medium text-sm hover:bg-green-50 transition"
            >
              📋 ยื่นคำขอลาสำหรับวันนี้
            </button>
          )}

          {/* วันหยุด */}
          {selectedData.isHoliday && !selectedData.hasLeave && !selectedData.hasWorkLog && (
            <div className="bg-purple-50 rounded-xl p-4 text-center">
              <p className="text-purple-700 text-sm">🎌 วันหยุด: {selectedData.holidayName}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">ปฏิทิน</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">

        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 text-lg">‹</button>
          <h2 className="font-semibold text-gray-800">
            {thaiMonths[viewMonth]} {viewYear + 543}
          </h2>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 text-lg">›</button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {thaiDays.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <p className="text-gray-400 text-sm">กำลังโหลด...</p>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = dateStr === todayStr
              const isSunday = idx % 7 === 0
              const isSaturday = idx % 7 === 6
              const d = dayData[dateStr]
              const isHoliday = d?.isHoliday
              const dots = getDotColors(dateStr)

              return (
                <button
                  key={idx}
                  onClick={() => handleDayClick(dateStr)}
                  className={`aspect-square flex flex-col items-center justify-center rounded-xl transition relative
                    ${isToday ? 'bg-blue-600 text-white' : isHoliday ? 'bg-purple-50' : 'hover:bg-gray-100'}
                    ${isSunday && !isToday ? 'text-red-500' : isSaturday && !isToday ? 'text-blue-500' : !isToday ? 'text-gray-700' : ''}
                  `}
                >
                  <span className="text-sm font-medium leading-none">{day}</span>
                  {dots.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
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
        <div className="mt-4 bg-white rounded-xl p-3 border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">สัญลักษณ์</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { color: 'bg-green-500', label: 'กรอกบันทึกงานแล้ว' },
              { color: 'bg-red-500', label: 'ลา (อนุมัติแล้ว)' },
              { color: 'bg-yellow-400', label: 'ลา (รออนุมัติ)' },
              { color: 'bg-purple-400', label: 'วันหยุดบริษัท' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.color}`} />
                <span className="text-xs text-gray-600">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}