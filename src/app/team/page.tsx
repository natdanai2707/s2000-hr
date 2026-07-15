'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, EmptyState } from '@/components/ui'
import { todayISO, formatThaiDate, formatThaiTime } from '@/lib/date'

interface LeaveToday {
  id: string
  employee: { name: string; position: string } | null
  leave_type: { name: string } | null
  late_minutes: number
}
interface AttToday {
  id: string
  check_in: string
  check_out: string | null
  employee: { name: string; position: string } | null
  site_location: { name: string } | null
}

export default function TeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [leaves, setLeaves] = useState<LeaveToday[]>([])
  const [atts, setAtts] = useState<AttToday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const canView = !!(session?.user?.approverId || session?.user?.isAdmin)
  const today = todayISO()

  useEffect(() => {
    if (status === 'loading') return
    if (!canView) {
      router.replace('/dashboard')
      return
    }
    fetchTeam()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canView])

  async function fetchTeam() {
    setLoading(true)
    setError('')
    try {
      // หา employee ids ของทีม: admin = ทุกคน, หัวหน้า = คนที่อยู่ในสายอนุมัติของตน
      let teamIds: string[] | null = null
      if (!session?.user?.isAdmin && session?.user?.approverId) {
        const { data: chains, error: chErr } = await supabase
          .from('approval_chains')
          .select('employee_id')
          .eq('approver_id', session.user.approverId)
        if (chErr) throw chErr
        teamIds = [...new Set((chains || []).map(c => c.employee_id))]
        if (teamIds.length === 0) {
          setLeaves([]); setAtts([]); setLoading(false); return
        }
      }

      const startOfDay = `${today}T00:00:00+07:00`
      const endOfDay = `${today}T23:59:59+07:00`

      let leaveQuery = supabase
        .from('leave_requests')
        .select('id, late_minutes, employee:employees(name, position), leave_type:leave_types(name)')
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today)
      if (teamIds) leaveQuery = leaveQuery.in('employee_id', teamIds)

      let attQuery = supabase
        .from('attendance_logs')
        .select('id, check_in, check_out, employee:employees(name, position), site_location:site_locations(name)')
        .gte('check_in', startOfDay)
        .lte('check_in', endOfDay)
        .order('check_in', { ascending: false })
      if (teamIds) attQuery = attQuery.in('employee_id', teamIds)

      const [leaveRes, attRes] = await Promise.all([leaveQuery, attQuery])
      if (leaveRes.error) throw leaveRes.error
      if (attRes.error) throw attRes.error

      setLeaves((leaveRes.data || []) as unknown as LeaveToday[])
      setAtts((attRes.data || []) as unknown as AttToday[])
    } catch (e) {
      console.error('team fetch error:', e)
      setError('โหลดข้อมูลทีมไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || !canView) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังโหลด...</p>
      </div>
    )
  }

  const onSite = atts.filter(a => !a.check_out)
  const checkedOut = atts.filter(a => a.check_out)

  // จัดกลุ่มคนที่อยู่ไซต์ตามชื่อไซต์
  const bySite: Record<string, AttToday[]> = {}
  for (const a of onSite) {
    const key = a.site_location?.name || 'ไม่ระบุไซต์'
    if (!bySite[key]) bySite[key] = []
    bySite[key].push(a)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="สรุปทีมวันนี้"
        subtitle={formatThaiDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
        onBack={() => router.push('/dashboard')}
      />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={fetchTeam} className="text-red-600 text-sm underline shrink-0 ml-2">ลองใหม่</button>
          </div>
        )}

        {/* สรุปตัวเลข */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-white rounded-xl py-3 border border-gray-100">
            <p className="text-xl font-bold text-brand-600">{onSite.length}</p>
            <p className="text-xs text-gray-500">อยู่ไซต์</p>
          </div>
          <div className="bg-white rounded-xl py-3 border border-gray-100">
            <p className="text-xl font-bold text-gray-700">{checkedOut.length}</p>
            <p className="text-xs text-gray-500">เช็คเอาท์แล้ว</p>
          </div>
          <div className="bg-white rounded-xl py-3 border border-gray-100">
            <p className="text-xl font-bold text-amber-500">{leaves.length}</p>
            <p className="text-xs text-gray-500">ลาวันนี้</p>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : (
          <>
            {/* อยู่ไซต์งานตอนนี้ */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">📍 อยู่ไซต์งานตอนนี้ ({onSite.length})</h2>
              {onSite.length === 0 ? (
                <EmptyState icon="🏗️" title="ยังไม่มีใครเช็คอินอยู่" hint="พนักงานที่เช็คอินแล้วยังไม่เช็คเอาท์จะแสดงที่นี่" />
              ) : (
                <div className="space-y-3">
                  {Object.entries(bySite).map(([siteName, list]) => (
                    <div key={siteName} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      <div className="bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">{siteName} · {list.length} คน</div>
                      <div className="divide-y divide-gray-50">
                        {list.map(a => (
                          <div key={a.id} className="px-3 py-2.5 flex items-center justify-between">
                            <div>
                              <p className="text-sm text-gray-800">{a.employee?.name}</p>
                              <p className="text-xs text-gray-400">{a.employee?.position}</p>
                            </div>
                            <span className="text-xs text-green-600">เข้า {formatThaiTime(a.check_in)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ลาวันนี้ */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">🌴 ลาวันนี้ ({leaves.length})</h2>
              {leaves.length === 0 ? (
                <EmptyState icon="✅" title="วันนี้ไม่มีคนลา" />
              ) : (
                <div className="space-y-2">
                  {leaves.map(l => (
                    <div key={l.id} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-800">{l.employee?.name}</p>
                        <p className="text-xs text-gray-400">{l.employee?.position}</p>
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]">
                        {l.leave_type?.name}{l.late_minutes > 0 ? ` (สาย ${l.late_minutes} น.)` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* เช็คเอาท์แล้ว */}
            {checkedOut.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">🔴 เช็คเอาท์แล้ววันนี้ ({checkedOut.length})</h2>
                <div className="space-y-2">
                  {checkedOut.map(a => (
                    <div key={a.id} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-800">{a.employee?.name}</p>
                        <p className="text-xs text-gray-400">{a.site_location?.name}</p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatThaiTime(a.check_in)} - {a.check_out ? formatThaiTime(a.check_out) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
