'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LeaveRequest } from '@/lib/types'
import { monthRange, eachDateInclusive } from '@/lib/date'
import { StatusChip, BottomNav, EmptyState } from '@/components/ui'
import { Icon } from '@/components/icons'
import type { IconName } from '@/components/icons'

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
  const [pendingOt, setPendingOt] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dayData, setDayData] = useState<Record<string, DayData>>({})
  const [calLoading, setCalLoading] = useState(true)
  const [showForceLogout, setShowForceLogout] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [regFirst, setRegFirst] = useState('')
  const [regLast, setRegLast] = useState('')
  const [regSubmitting, setRegSubmitting] = useState(false)
  const [regDone, setRegDone] = useState(false)
  const [regError, setRegError] = useState('')

  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  // Force logout timer ถ้าโหลดนานเกิน 6 วินาที
  useEffect(() => {
    const timer = setTimeout(() => setShowForceLogout(true), 6000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // ผู้จัดการ (login ด้วยอีเมล) ไม่ใช้หน้าพนักงาน — ส่งไปหน้าจัดการระบบ
  useEffect(() => {
    if (status === 'loading') return
    if (session?.user?.isManager && !session?.user?.employeeId) {
      router.replace('/admin')
    }
  }, [session, status, router])

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
    setLoadError('')
    try {
      const { data: requests, error: reqErr } = await supabase
        .from('leave_requests')
        .select('*, leave_type:leave_types(*)')
        .eq('employee_id', session!.user.employeeId!)
        .order('created_at', { ascending: false })
        .limit(5)
      if (reqErr) throw reqErr
      setMyRequests(requests || [])

      if (session?.user?.approverId) {
        const { data: chains, error: chErr } = await supabase
          .from('approval_chains')
          .select('employee_id, level')
          .eq('approver_id', session.user.approverId)
        if (chErr) throw chErr

        // map employee_id -> level ที่ผู้อนุมัติคนนี้ต้องอนุมัติ
        const levelByEmp = new Map<string, number>()
        for (const c of chains || []) levelByEmp.set(c.employee_id, c.level)
        const empIds = [...levelByEmp.keys()]

        if (empIds.length > 0) {
          // batch query เดียวแทน loop ทีละคน (แก้ปัญหา N+1)
          // ดึงทั้งคำขอลาและ OT ที่รออนุมัติพร้อมกัน
          const [leaveRes, otRes] = await Promise.all([
            supabase
              .from('leave_requests')
              .select('*, employee:employees(*), leave_type:leave_types(*)')
              .in('employee_id', empIds)
              .eq('status', 'pending'),
            supabase
              .from('ot_requests')
              .select('*, employee:employees(*)')
              .in('employee_id', empIds)
              .eq('status', 'pending'),
          ])
          if (leaveRes.error) throw leaveRes.error
          if (otRes.error) throw otRes.error

          // แสดงเฉพาะรายการที่ตรงกับ level ของผู้อนุมัติคนนี้
          setPendingApprovals(
            (leaveRes.data || []).filter(r => levelByEmp.get(r.employee_id) === r.current_approval_level)
          )
          setPendingOt(
            (otRes.data || []).filter(r => levelByEmp.get(r.employee_id) === r.current_approval_level)
          )
        } else {
          setPendingApprovals([])
          setPendingOt([])
        }
      }
    } catch (e) {
      console.error('fetchData error:', e)
      setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCalendarData() {
    setCalLoading(true)
    const ym = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
    const { start: startDate, end: endDate } = monthRange(ym)

    try {
      const [logsRes, leavesRes, holidaysRes] = await Promise.all([
        supabase.from('work_logs').select('log_date').eq('employee_id', session!.user.employeeId!).gte('log_date', startDate).lte('log_date', endDate),
        supabase.from('leave_requests').select('start_date, end_date, status').eq('employee_id', session!.user.employeeId!).gte('start_date', startDate).lte('end_date', endDate),
        supabase.from('holidays').select('date, name').gte('date', startDate).lte('date', endDate).eq('is_active', true),
      ])

      const data: Record<string, DayData> = {}

      for (const log of logsRes.data || []) {
        const d = log.log_date
        if (!data[d]) data[d] = emptyDay()
        data[d].hasWorkLog = true
      }

      for (const leave of leavesRes.data || []) {
        for (const dateStr of eachDateInclusive(leave.start_date, leave.end_date)) {
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
    } catch (e) {
      console.error('fetchCalendarData error:', e)
    } finally {
      setCalLoading(false)
    }
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

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <p className="text-gray-500">กำลังโหลด...</p>
        {showForceLogout && (
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-2">ใช้เวลานานเกินไป</p>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-sm text-red-500 border border-red-300 px-4 py-2 rounded-lg"
            >
              ออกจากระบบ
            </button>
          </div>
        )}
      </div>
    )
  }

  if (!session?.user?.employeeId) {
    // ผู้จัดการถูกส่งไป /admin โดย effect ด้านบน — แสดงจอรอระหว่างเปลี่ยนหน้า
    if (session?.user?.isManager) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-400">กำลังเข้าสู่หน้าจัดการระบบ...</p>
        </div>
      )
    }
    const submitRegistration = async () => {
      if (!regFirst.trim() || !regLast.trim()) {
        setRegError('กรุณากรอกชื่อจริงและนามสกุล')
        return
      }
      setRegSubmitting(true)
      setRegError('')
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName: regFirst.trim(), lastName: regLast.trim() }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || 'ส่งข้อมูลไม่สำเร็จ')
        }
        setRegDone(true)
      } catch (e: any) {
        console.error('register error:', e)
        setRegError(e?.message || 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่')
      } finally {
        setRegSubmitting(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 p-6">
          {regDone ? (
            <div className="text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-800 font-semibold mb-1">ส่งข้อมูลเรียบร้อยแล้ว</p>
              <p className="text-sm text-gray-500 mb-4">
                ระบบบันทึกชื่อและบัญชี LINE ของคุณแล้ว<br />
                รอ HR ยืนยันและเพิ่มคุณเข้าระบบ จากนั้นเข้าสู่ระบบใหม่อีกครั้ง
              </p>
              <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-xs text-gray-400 underline min-h-11">
                ออกจากระบบ
              </button>
            </div>
          ) : (
            <>
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">👋</div>
                <p className="text-gray-800 font-semibold">ยินดีต้อนรับสู่ S-2000 HR</p>
                <p className="text-sm text-gray-500 mt-1">
                  บัญชี LINE ของคุณยังไม่ได้ลงทะเบียน<br />กรอกชื่อ-นามสกุลเพื่อส่งข้อมูลเข้าระบบ
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อจริง</label>
                  <input
                    type="text"
                    value={regFirst}
                    onChange={e => { setRegFirst(e.target.value); setRegError('') }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
                    placeholder="เช่น สมชาย"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">นามสกุล</label>
                  <input
                    type="text"
                    value={regLast}
                    onChange={e => { setRegLast(e.target.value); setRegError('') }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
                    placeholder="เช่น ใจดี"
                  />
                </div>

                {regError && <p className="text-red-500 text-sm">{regError}</p>}

                <button
                  onClick={submitRegistration}
                  disabled={regSubmitting}
                  className="w-full bg-brand-600 text-white rounded-xl py-3 min-h-11 font-medium disabled:opacity-50"
                >
                  {regSubmitting ? 'กำลังส่ง...' : 'ส่งข้อมูลเข้าระบบ'}
                </button>

                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="w-full text-xs text-gray-400 underline min-h-11"
                >
                  ออกจากระบบ
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-3 sticky top-0 z-20">
        <div className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center font-semibold shrink-0">
          {(session.user.employeeName || 'S').trim().charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{session.user.employeeName}</p>
          <p className="text-xs text-gray-400 truncate">{session.user.position}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          aria-label="ออกจากระบบ"
          className="tap-target text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-600"
        >
          <Icon name="logout" width={20} height={20} />
        </button>
      </div>

      <div className="max-w-lg mx-auto px-3 py-3 pb-24 space-y-4">

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-red-600 text-sm">{loadError}</p>
            <button onClick={() => fetchData()} className="text-red-600 text-sm underline shrink-0 ml-2">ลองใหม่</button>
          </div>
        )}

        {/* ปฏิทิน */}
        <div className="bg-white rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2 px-1">
            <button onClick={prevMonth} aria-label="เดือนก่อน" className="tap-target rounded-lg hover:bg-gray-100 text-gray-500"><Icon name="chevronLeft" width={20} height={20} /></button>
            <span className="font-semibold text-gray-800 text-sm">{thaiMonths[viewMonth]} {viewYear + 543}</span>
            <button onClick={nextMonth} aria-label="เดือนถัดไป" className="tap-target rounded-lg hover:bg-gray-100 text-gray-500"><Icon name="chevronRight" width={20} height={20} /></button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {thaiDays.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-400'}`}>{d}</div>
            ))}
          </div>

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

        {/* Pending OT Approvals */}
        {pendingOt.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">OT รออนุมัติจากคุณ ({pendingOt.length})</h2>
            <div className="space-y-2">
              {pendingOt.map((req) => (
                <div key={req.id} onClick={() => router.push(`/ot/${req.id}`)} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 cursor-pointer hover:bg-yellow-100 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{req.employee?.name}</p>
                      <p className="text-xs text-gray-500">⏰ OT {req.request_date} · {req.ot_hours} ชม. ({req.multiplier}x)</p>
                    </div>
                    <span className="text-yellow-600 text-xs">อนุมัติ →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {(() => {
          const actions: { icon: IconName; label: string; sub: string; href: string; color: string }[] = [
            { icon: 'clipboard', label: 'ยื่นคำขอลา', sub: 'ลา / มาสาย / ขาด', href: '/leave/new', color: 'bg-emerald-500' },
            { icon: 'briefcase', label: 'บันทึกงาน', sub: 'รายงานการปฏิบัติงาน', href: '/worklog/new', color: 'bg-blue-500' },
            { icon: 'mapPin', label: 'เช็คอิน/เอาท์', sub: 'บันทึกเวลาเข้า-ออก', href: '/attendance', color: 'bg-orange-500' },
            { icon: 'clock', label: 'ขอทำ OT', sub: 'ยื่นขออนุมัติ OT', href: '/ot/new', color: 'bg-amber-500' },
            { icon: 'fileText', label: 'ประวัติคำขอ', sub: 'ลา / OT / บันทึกงาน', href: '/requests', color: 'bg-slate-500' },
            { icon: 'receipt', label: 'สลิปเงินเดือน', sub: 'ดูย้อนหลัง', href: '/payslip', color: 'bg-violet-500' },
            ...(session.user.approverId
              ? ([
                  { icon: 'users', label: 'สรุปทีมวันนี้', sub: 'ใครลา/อยู่ไซต์', href: '/team', color: 'bg-sky-500' },
                  { icon: 'checkCircle', label: 'อนุมัติบันทึกงาน', sub: 'เซ็นรับรองลูกทีม', href: '/worklog/approve', color: 'bg-teal-500' },
                ] as { icon: IconName; label: string; sub: string; href: string; color: string }[])
              : []),
          ]
          return (
            <div className="grid grid-cols-2 gap-2.5">
              {actions.map(a => (
                <button
                  key={a.href}
                  onClick={() => router.push(a.href)}
                  className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-sm text-left transition active:scale-[0.98] hover:border-gray-200"
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white mb-2.5 ${a.color}`}>
                    <Icon name={a.icon} width={22} height={22} />
                  </div>
                  <p className="font-semibold text-sm text-gray-800 leading-tight">{a.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.sub}</p>
                </button>
              ))}
            </div>
          )
        })()}

        {/* My Leave Requests */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">คำขอลาของฉัน</h2>
            <button onClick={() => router.push('/requests')} className="text-xs text-blue-500 min-h-11 px-2">ดูทั้งหมด</button>
          </div>
          {myRequests.length === 0 ? (
            <EmptyState icon="📋" title="ยังไม่มีคำขอลา" hint="กดปุ่ม “ยื่นคำขอลา” ด้านบนเพื่อเริ่มยื่นลา มาสาย หรือขาดงาน" />
          ) : (
            <div className="space-y-2">
              {myRequests.map((req) => (
                <div key={req.id} onClick={() => router.push(`/leave/${req.id}`)} className="bg-white rounded-xl p-3 cursor-pointer hover:bg-gray-50 transition border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{(req as any).leave_type?.name}</p>
                      <p className="text-xs text-gray-500">{req.start_date}{req.end_date !== req.start_date ? ` ถึง ${req.end_date}` : ''} · {req.total_days} วัน</p>
                    </div>
                    <StatusChip status={req.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin */}
        {session.user.isAdmin && (
          <button onClick={() => router.push('/admin')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 min-h-11">
            ⚙️ จัดการระบบ (Admin)
          </button>
        )}
      </div>

      <BottomNav />
    </div>
  )
}