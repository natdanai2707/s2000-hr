'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { Project, WorkLog } from '@/lib/types'
import { todayISO, currentMonthISO, monthRange, formatThaiDate } from '@/lib/date'
import { Button, FieldError, PageHeader, EmptyState } from '@/components/ui'

interface WorkLogEntry {
  id?: string
  project_id: string
  job_code: string
  task_description: string
  hours_spent: string
  ot_hours: string
  site_location: string
  water_allowance: string
  daily_allowance: string
  other_income: string
  notes: string
  log_date: string
}

const emptyEntry = (): WorkLogEntry => ({
  project_id: '',
  job_code: '',
  task_description: '',
  hours_spent: '',
  ot_hours: '',
  site_location: '',
  water_allowance: '',
  daily_allowance: '',
  other_income: '',
  notes: '',
  log_date: todayISO(),
})

export default function WorkLogPage() {
  const { data: session } = useSession()
  const [projects, setProjects] = useState<Project[]>([])
  const [logs, setLogs] = useState<WorkLog[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [entry, setEntry] = useState<WorkLogEntry>(emptyEntry())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ desc?: string; date?: string }>({})
  const [filterMonth, setFilterMonth] = useState(currentMonthISO())

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (session?.user?.employeeId) fetchLogs()
  }, [session, filterMonth])

  async function fetchProjects() {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('is_active', true)
      .order('project_code')
    setProjects(data || [])
  }

  async function fetchLogs() {
    const { start: startDate, end: endDate } = monthRange(filterMonth)

    const { data } = await supabase
      .from('work_logs')
      .select('*, project:projects(*)')
      .eq('employee_id', session!.user.employeeId!)
      .gte('log_date', startDate)
      .lte('log_date', endDate)
      .order('log_date', { ascending: false })
    setLogs(data || [])
  }

  function handleEdit(log: any) {
    setEntry({
      id: log.id,
      project_id: log.project_id || '',
      job_code: log.job_code || '',
      task_description: log.task_description || '',
      hours_spent: log.hours_spent?.toString() || '',
      ot_hours: log.ot_hours?.toString() || '',
      site_location: log.site_location || '',
      water_allowance: log.water_allowance?.toString() || '',
      daily_allowance: log.daily_allowance?.toString() || '',
      other_income: log.other_income?.toString() || '',
      notes: log.notes || '',
      log_date: log.log_date,
    })
    setEditingId(log.id)
    setError('')
    setFieldErrors({})
    setShowForm(true)
  }

  function handleNew() {
    setEntry(emptyEntry())
    setEditingId(null)
    setError('')
    setFieldErrors({})
    setShowForm(true)
  }

  async function handleSubmit() {
    if (!session?.user?.employeeId) return
    const fe: { desc?: string; date?: string } = {}
    if (!entry.task_description) fe.desc = 'กรุณากรอกรายละเอียดงาน'
    if (!entry.log_date) fe.date = 'กรุณาเลือกวันที่'
    setFieldErrors(fe)
    if (fe.desc || fe.date) return

    setSubmitting(true)
    setError('')

    const payload = {
      employee_id: session.user.employeeId,
      log_date: entry.log_date,
      project_id: entry.project_id || null,
      job_code: entry.job_code || null,
      task_description: entry.task_description,
      hours_spent: entry.hours_spent ? parseFloat(entry.hours_spent) : null,
      ot_hours: entry.ot_hours ? parseFloat(entry.ot_hours) : 0,
      site_location: entry.site_location || null,
      water_allowance: entry.water_allowance ? parseFloat(entry.water_allowance) : 0,
      daily_allowance: entry.daily_allowance ? parseFloat(entry.daily_allowance) : 0,
      other_income: entry.other_income ? parseFloat(entry.other_income) : 0,
      notes: entry.notes || null,
      updated_at: new Date().toISOString(),
    }

    let err
    if (editingId) {
      // แก้ไขแล้วต้องให้หัวหน้าอนุมัติใหม่
      const { error: e } = await supabase
        .from('work_logs')
        .update({ ...payload, approval_status: 'pending', approved_by: null, approved_at: null })
        .eq('id', editingId)
      err = e
    } else {
      const { error: e } = await supabase.from('work_logs').insert(payload)
      err = e
    }

    if (err) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setSubmitting(false)
      return
    }

    setShowForm(false)
    setEditingId(null)
    setEntry(emptyEntry())
    fetchLogs()
    setSubmitting(false)
  }

  // Group logs by date
  const grouped = logs.reduce((acc: Record<string, any[]>, log) => {
    if (!acc[log.log_date]) acc[log.log_date] = []
    acc[log.log_date].push(log)
    return acc
  }, {})

  const totalHours = logs.reduce((sum, l: any) => sum + (l.hours_spent || 0), 0)
  const totalOT = logs.reduce((sum, l: any) => sum + (l.ot_hours || 0), 0)
  const totalWater = logs.reduce((sum, l: any) => sum + (l.water_allowance || 0), 0)
  const totalAllowance = logs.reduce((sum, l: any) => sum + (l.daily_allowance || 0), 0)

  if (showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader
          title={editingId ? 'แก้ไขรายการงาน' : 'บันทึกการปฏิบัติงาน'}
          onBack={() => { setShowForm(false); setEditingId(null) }}
        />

        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
            <input
              type="date"
              value={entry.log_date}
              onChange={e => { setEntry({ ...entry, log_date: e.target.value }); setFieldErrors(fe => ({ ...fe, date: undefined })) }}
              className={`w-full border rounded-lg px-3 py-2.5 min-h-11 text-gray-800 ${fieldErrors.date ? 'border-red-400' : 'border-gray-300'}`}
            />
            <FieldError message={fieldErrors.date} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">สถานที่ทำงาน</label>
            <input
              type="text"
              value={entry.site_location}
              onChange={e => setEntry({ ...entry, site_location: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              placeholder="เช่น ไซต์งานหาดใหญ่, สำนักงาน"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">งาน</label>
            <select
              value={entry.project_id}
              onChange={e => setEntry({ ...entry, project_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800 bg-white"
            >
              <option value="">เลือกงาน</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.project_code === 'รอเปิด job' || p.project_code === 'อื่นๆ'
                    ? p.project_code
                    : `(${p.project_code}) ${p.project_name}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดงาน *</label>
            <textarea
              value={entry.task_description}
              onChange={e => { setEntry({ ...entry, task_description: e.target.value }); setFieldErrors(fe => ({ ...fe, desc: undefined })) }}
              rows={3}
              className={`w-full border rounded-lg px-3 py-2.5 text-gray-800 resize-none ${fieldErrors.desc ? 'border-red-400' : 'border-gray-300'}`}
              placeholder="อธิบายงานที่ทำ..."
            />
            <FieldError message={fieldErrors.desc} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชั่วโมงทำงาน</label>
              <input
                type="number"
                value={entry.hours_spent}
                onChange={e => setEntry({ ...entry, hours_spent: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="ชม."
                min={0}
                step={0.5}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OT (ชั่วโมง)</label>
              <input
                type="number"
                value={entry.ot_hours}
                onChange={e => setEntry({ ...entry, ot_hours: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="ชม."
                min={0}
                step={0.5}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ค่าน้ำ (บาท)</label>
              <input
                type="number"
                value={entry.water_allowance}
                onChange={e => setEntry({ ...entry, water_allowance: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="0"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบี้ยเลี้ยง (บาท)</label>
              <input
                type="number"
                value={entry.daily_allowance}
                onChange={e => setEntry({ ...entry, daily_allowance: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="0"
                min={0}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เงินได้อื่นๆ (บาท)</label>
            <input
              type="number"
              value={entry.other_income}
              onChange={e => setEntry({ ...entry, other_income: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              placeholder="0"
              min={0}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={entry.notes}
              onChange={e => setEntry({ ...entry, notes: e.target.value })}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800 resize-none"
              placeholder="หมายเหตุเพิ่มเติม..."
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <Button variant="primary" fullWidth onClick={handleSubmit} disabled={submitting} className="py-3">
            {submitting ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'บันทึกการปฏิบัติงาน'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="บันทึกการปฏิบัติงาน"
        right={<Button variant="primary" onClick={handleNew} className="px-3">+ เพิ่มรายการ</Button>}
      />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Filter เดือน */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">เลือกเดือน</label>
          <input
            type="month"
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
          />
        </div>

        {/* สรุปเดือน */}
        {logs.length > 0 && (
          <div className="bg-blue-50 rounded-xl p-4 grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-500">ชั่วโมงรวม</p>
              <p className="font-semibold text-gray-800">{totalHours} ชม.</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">OT รวม</p>
              <p className="font-semibold text-gray-800">{totalOT} ชม.</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">ค่าน้ำรวม</p>
              <p className="font-semibold text-gray-800">{totalWater.toLocaleString()} บาท</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">เบี้ยเลี้ยงรวม</p>
              <p className="font-semibold text-gray-800">{totalAllowance.toLocaleString()} บาท</p>
            </div>
          </div>
        )}

        {/* รายการตามวัน */}
        {Object.keys(grouped).length === 0 ? (
          <EmptyState
            icon="🔧"
            title="ยังไม่มีบันทึกงานในเดือนนี้"
            hint="กด “เพิ่มรายการ” เพื่อบันทึกงานที่ทำในแต่ละวัน"
            action={<Button variant="primary" onClick={handleNew}>+ เพิ่มรายการ</Button>}
          />
        ) : (
          Object.entries(grouped).map(([date, dayLogs]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {formatThaiDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <div className="space-y-2">
                {dayLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="bg-white rounded-xl p-4 border border-gray-100"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-800 text-sm">{log.task_description}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${log.approval_status === 'approved' ? 'bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]' : 'bg-[var(--color-pending-bg)] text-[var(--color-pending-fg)]'}`}>
                            {log.approval_status === 'approved' ? '✓ หัวหน้าอนุมัติแล้ว' : 'รอหัวหน้าอนุมัติ'}
                          </span>
                        </div>
                        {log.site_location && (
                          <p className="text-xs text-gray-500 mt-0.5">📍 {log.site_location}</p>
                        )}
                        {log.job_code && (
                          <p className="text-xs text-gray-400">รหัส: {log.job_code}</p>
                        )}
                        {log.project && (
                          <p className="text-xs text-gray-400">{log.project.project_name}</p>
                        )}
                        <div className="flex gap-3 mt-1 flex-wrap">
                          {log.hours_spent > 0 && (
                            <span className="text-xs text-blue-600">{log.hours_spent} ชม.</span>
                          )}
                          {log.ot_hours > 0 && (
                            <span className="text-xs text-orange-500">OT {log.ot_hours} ชม.</span>
                          )}
                          {log.water_allowance > 0 && (
                            <span className="text-xs text-cyan-600">น้ำ {log.water_allowance} บ.</span>
                          )}
                          {log.daily_allowance > 0 && (
                            <span className="text-xs text-green-600">เบี้ย {log.daily_allowance} บ.</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEdit(log)}
                        className="text-xs text-blue-500 ml-2 shrink-0"
                      >
                        แก้ไข
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}