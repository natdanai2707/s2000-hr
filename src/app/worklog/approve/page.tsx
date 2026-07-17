'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, Button, EmptyState } from '@/components/ui'
import { currentMonthISO, monthRange, formatThaiDate } from '@/lib/date'

interface Log {
  id: string
  employee_id: string
  log_date: string
  task_description: string
  hours_spent: number | null
  ot_hours: number | null
  approval_status: string
  employee: { name: string; employee_code: string } | null
}

export default function WorklogApprovePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonthISO())
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyEmp, setBusyEmp] = useState<string | null>(null)

  const canView = !!(session?.user?.approverId || session?.user?.isAdmin)

  useEffect(() => {
    if (status === 'loading') return
    if (!canView) {
      router.replace('/dashboard')
      return
    }
    fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canView, month])

  async function fetchLogs() {
    setLoading(true)
    setError('')
    try {
      let teamIds: string[] | null = null
      if (!session?.user?.isAdmin && session?.user?.approverId) {
        const { data: chains, error: chErr } = await supabase
          .from('approval_chains')
          .select('employee_id')
          .eq('approver_id', session.user.approverId)
        if (chErr) throw chErr
        teamIds = [...new Set((chains || []).map(c => c.employee_id))]
        if (teamIds.length === 0) { setLogs([]); setLoading(false); return }
      }

      const { start, end } = monthRange(month)
      let q = supabase
        .from('work_logs')
        .select('id, employee_id, log_date, task_description, hours_spent, ot_hours, approval_status, employee:employees(name, employee_code)')
        .gte('log_date', start)
        .lte('log_date', end)
        .order('log_date', { ascending: true })
      if (teamIds) q = q.in('employee_id', teamIds)

      const { data, error: e } = await q
      if (e) throw e
      setLogs((data || []) as unknown as Log[])
    } catch (err) {
      console.error('fetch worklog approve error:', err)
      setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function approveAll(empId: string) {
    if (!session?.user?.approverId) {
      setError('เฉพาะผู้อนุมัติเท่านั้น')
      return
    }
    setBusyEmp(empId)
    setError('')
    try {
      const { start, end } = monthRange(month)
      const { error: e } = await supabase
        .from('work_logs')
        .update({
          approval_status: 'approved',
          approved_by: session.user.approverId,
          approved_at: new Date().toISOString(),
        })
        .eq('employee_id', empId)
        .gte('log_date', start)
        .lte('log_date', end)
        .eq('approval_status', 'pending')
      if (e) throw e
      setLogs(rows => rows.map(r => (r.employee_id === empId ? { ...r, approval_status: 'approved' } : r)))
    } catch (err) {
      console.error('approve all error:', err)
      setError('อนุมัติไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setBusyEmp(null)
    }
  }

  if (status === 'loading' || !canView) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังโหลด...</p></div>
  }

  // จัดกลุ่มตามพนักงาน
  const byEmp: Record<string, { name: string; code: string; logs: Log[] }> = {}
  for (const l of logs) {
    if (!byEmp[l.employee_id]) {
      byEmp[l.employee_id] = { name: l.employee?.name || '(ไม่ทราบชื่อ)', code: l.employee?.employee_code || '', logs: [] }
    }
    byEmp[l.employee_id].logs.push(l)
  }
  const totalPending = logs.filter(l => l.approval_status !== 'approved').length

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="อนุมัติบันทึกงาน" subtitle="ตรวจ/เซ็นรับรองบันทึกงานลูกทีม" onBack={() => router.push('/dashboard')} />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 min-h-11 text-sm text-gray-800 bg-white"
          />
          <span className="text-sm text-gray-500">รออนุมัติ {totalPending} รายการ</span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={fetchLogs} className="text-red-600 text-sm underline shrink-0 ml-2">ลองใหม่</button>
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : Object.keys(byEmp).length === 0 ? (
          <EmptyState icon="📋" title="ไม่มีบันทึกงานในเดือนนี้" hint="เลือกเดือนอื่น หรือรอลูกทีมกรอกบันทึกงาน" />
        ) : (
          Object.entries(byEmp).map(([empId, g]) => {
            const pending = g.logs.filter(l => l.approval_status !== 'approved').length
            return (
              <div key={empId} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{g.name}</p>
                    <p className="text-xs text-gray-400">{g.code} · {g.logs.length} รายการ · รออนุมัติ {pending}</p>
                  </div>
                  {pending > 0 ? (
                    <Button variant="primary" onClick={() => approveAll(empId)} disabled={busyEmp === empId} className="px-3">
                      {busyEmp === empId ? '...' : `อนุมัติทั้งหมด (${pending})`}
                    </Button>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]">✓ อนุมัติครบ</span>
                  )}
                </div>
                <div className="divide-y divide-gray-50">
                  {g.logs.map(l => (
                    <div key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400">{formatThaiDate(l.log_date, { day: 'numeric', month: 'short', weekday: 'short' })}</p>
                        <p className="text-sm text-gray-800 truncate">{l.task_description}</p>
                        <div className="flex gap-2 text-xs text-gray-400">
                          {(l.hours_spent || 0) > 0 && <span>{l.hours_spent} ชม.</span>}
                          {(l.ot_hours || 0) > 0 && <span className="text-orange-500">OT {l.ot_hours} ชม.</span>}
                        </div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${l.approval_status === 'approved' ? 'bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]' : 'bg-[var(--color-pending-bg)] text-[var(--color-pending-fg)]'}`}>
                        {l.approval_status === 'approved' ? '✓' : 'รอ'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
