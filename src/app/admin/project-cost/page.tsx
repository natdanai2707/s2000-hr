'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, Button, EmptyState } from '@/components/ui'
import { currentMonthISO, monthRange, formatThaiDate } from '@/lib/date'
import { formatBaht } from '@/lib/payroll'
import { EmpRate, WorkLogRow, ProjectCost, aggregateByProject } from '@/lib/projectCost'

export default function ProjectCostPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonthISO())
  const [rows, setRows] = useState<ProjectCost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) { router.replace('/dashboard'); return }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, month])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const { start, end } = monthRange(month)
      const [empRes, logsRes] = await Promise.all([
        supabase.from('employees').select('id, employee_code, name, employee_type, daily_rate, monthly_salary'),
        supabase
          .from('work_logs')
          .select('employee_id, project_id, log_date, hours_spent, ot_hours, water_allowance, daily_allowance, other_income, project:projects(project_code, project_name)')
          .gte('log_date', start)
          .lte('log_date', end),
      ])
      if (empRes.error) throw empRes.error
      if (logsRes.error) throw logsRes.error
      const empMap = new Map((empRes.data as EmpRate[]).map(e => [e.id, e]))
      setRows(aggregateByProject((logsRes.data || []) as unknown as WorkLogRow[], empMap))
    } catch (e) {
      console.error('project cost error:', e)
      setError('โหลดรายงานไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function download() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/export/project-cost?month=${month}`)
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a = document.createElement('a')
      const url = URL.createObjectURL(blob)
      a.href = url
      a.download = `project_cost_${month}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setDownloading(false)
    }
  }

  if (status === 'loading' || !session?.user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p></div>
  }

  const grand = rows.reduce(
    (a, r) => ({
      labor: a.labor + r.laborCost,
      ot: a.ot + r.otCost,
      allowance: a.allowance + r.allowance,
      total: a.total + r.total,
    }),
    { labor: 0, ot: 0, allowance: 0, total: 0 }
  )
  const monthLabel = formatThaiDate(`${month}-01`, { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ต้นทุนแรงงานต่องาน" subtitle="รายงานต้นทุนต่อโปรเจกต์" onBack={() => router.push('/admin')} />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">เลือกเดือน</label>
            <input
              type="month"
              value={month}
              max={currentMonthISO()}
              onChange={e => setMonth(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-11 text-sm text-gray-800 bg-white"
            />
          </div>
          <Button variant="secondary" onClick={download} disabled={downloading || rows.length === 0} className="shrink-0">
            {downloading ? '...' : '📥 Excel'}
          </Button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={fetchData} className="text-red-600 text-sm underline shrink-0 ml-2">ลองใหม่</button>
          </div>
        )}

        {/* สรุปรวม */}
        {!loading && rows.length > 0 && (
          <div className="bg-brand-600 text-white rounded-2xl p-4">
            <p className="text-sm opacity-90">ต้นทุนแรงงานรวม {monthLabel}</p>
            <p className="text-2xl font-bold tabular-nums">{formatBaht(grand.total)} บาท</p>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
              <div className="bg-white/15 rounded-lg py-1.5">
                <p className="opacity-80">ค่าแรง</p>
                <p className="font-semibold tabular-nums">{formatBaht(grand.labor)}</p>
              </div>
              <div className="bg-white/15 rounded-lg py-1.5">
                <p className="opacity-80">ค่า OT</p>
                <p className="font-semibold tabular-nums">{formatBaht(grand.ot)}</p>
              </div>
              <div className="bg-white/15 rounded-lg py-1.5">
                <p className="opacity-80">เบี้ย/น้ำ/อื่นๆ</p>
                <p className="font-semibold tabular-nums">{formatBaht(grand.allowance)}</p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <EmptyState icon="📊" title="ยังไม่มีบันทึกงานในเดือนนี้" hint="ต้นทุนคำนวณจากบันทึกการปฏิบัติงานที่ผูกกับงาน/โปรเจกต์" />
        ) : (
          <div className="space-y-2">
            {rows.map(r => {
              const pct = grand.total > 0 ? Math.round((r.total / grand.total) * 100) : 0
              return (
                <div key={r.projectId} className="bg-white rounded-xl p-3 border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.projectName}</p>
                      <p className="text-xs text-gray-400">{r.projectCode !== '-' ? `${r.projectCode} · ` : ''}{r.workers} คน · {r.totalHours} ชม.{r.totalOtHours > 0 ? ` · OT ${r.totalOtHours} ชม.` : ''}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-sm font-bold text-gray-800 tabular-nums">{formatBaht(r.total)}</p>
                      <p className="text-xs text-gray-400">{pct}%</p>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                    <div className="bg-brand-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex gap-3 mt-1.5 text-xs text-gray-400">
                    <span>ค่าแรง {formatBaht(r.laborCost)}</span>
                    {r.otCost > 0 && <span>OT {formatBaht(r.otCost)}</span>}
                    {r.allowance > 0 && <span>เบี้ย/อื่นๆ {formatBaht(r.allowance)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-xs text-gray-400 px-1">
          * ต้นทุนประมาณการจากเรทพนักงาน × ชั่วโมงที่บันทึก (OT 1.5x) + เบี้ยเลี้ยง/ค่าน้ำ/เงินได้อื่น
        </p>
      </div>
    </div>
  )
}
