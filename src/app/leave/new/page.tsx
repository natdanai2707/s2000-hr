'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LeaveType } from '@/lib/types'
import { todayISO, daysBetweenInclusive, eachDateInclusive } from '@/lib/date'
import { Button, FieldError, PageHeader } from '@/components/ui'

interface LeaveQuota {
  sick_leave_quota: number
  personal_leave_quota: number
  vacation_leave_quota: number
}

interface LeaveUsage {
  sick: number
  personal: number
  vacation: number
}

export default function NewLeavePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [quota, setQuota] = useState<LeaveQuota | null>(null)
  const [usage, setUsage] = useState<LeaveUsage>({ sick: 0, personal: 0, vacation: 0 })
  const [holidays, setHolidays] = useState<string[]>([])
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    late_minutes: 0,
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ type?: string; date?: string }>({})

  useEffect(() => {
    fetchLeaveTypes()
    fetchHolidays()
    if (session?.user?.employeeId) {
      fetchQuotaAndUsage()
    }
  }, [session])

  async function fetchLeaveTypes() {
    const { data } = await supabase.from('leave_types').select('*').order('name')
    setLeaveTypes(data || [])
  }

  async function fetchHolidays() {
    const year = new Date().getFullYear()
    const { data } = await supabase
      .from('holidays')
      .select('date')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('is_active', true)
    setHolidays((data || []).map(h => h.date))
  }

  async function fetchQuotaAndUsage() {
    const { data: emp } = await supabase
      .from('employees')
      .select('sick_leave_quota, personal_leave_quota, vacation_leave_quota')
      .eq('id', session!.user.employeeId!)
      .single()
    if (emp) setQuota(emp)

    const year = new Date().getFullYear()
    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('total_days, leave_type:leave_types(code)')
      .eq('employee_id', session!.user.employeeId!)
      .eq('status', 'approved')
      .gte('start_date', `${year}-01-01`)
      .lte('end_date', `${year}-12-31`)

    const u = { sick: 0, personal: 0, vacation: 0 }
    for (const l of leaves || []) {
      const code = (l as any).leave_type?.code
      if (code === 'SICK' || code === 'SICK_NODOC') u.sick += l.total_days
      if (code === 'PERSONAL') u.personal += l.total_days
      if (code === 'VACATION') u.vacation += l.total_days
    }
    setUsage(u)
  }

  function calcDays() {
    return daysBetweenInclusive(form.start_date, form.end_date)
  }

  function checkHolidayConflict(): string | null {
    if (!form.start_date || !form.end_date) return null
    for (const dateStr of eachDateInclusive(form.start_date, form.end_date)) {
      if (holidays.includes(dateStr)) {
        return dateStr
      }
    }
    return null
  }

  async function checkPayrollLockout(): Promise<string | null> {
    if (!form.start_date) return null
    const { data } = await supabase
      .from('payroll_periods')
      .select('period_name')
      .eq('is_locked', true)
      .lte('start_date', form.start_date)
      .gte('end_date', form.start_date)
      .limit(1)
      .maybeSingle()
    return data ? data.period_name : null
  }

  function checkQuota(): string | null {
    if (!quota || !selectedType) return null
    const days = calcDays()
    const code = selectedType.code

    if (code === 'SICK' || code === 'SICK_NODOC') {
      const remaining = quota.sick_leave_quota - usage.sick
      if (days > remaining) return `ลาป่วยเหลือ ${remaining} วัน แต่ขอ ${days} วัน`
    }
    if (code === 'PERSONAL') {
      const remaining = quota.personal_leave_quota - usage.personal
      if (days > remaining) return `ลากิจเหลือ ${remaining} วัน แต่ขอ ${days} วัน`
    }
    if (code === 'VACATION') {
      const remaining = quota.vacation_leave_quota - usage.vacation
      if (days > remaining) return `ลาพักร้อนเหลือ ${remaining} วัน แต่ขอ ${days} วัน`
    }
    return null
  }

  const selectedType = leaveTypes.find(t => t.id === form.leave_type_id)
  const isLate = selectedType?.code === 'LATE'

  async function handleSubmit() {
    const fe: { type?: string; date?: string } = {}
    if (!form.leave_type_id) fe.type = 'กรุณาเลือกประเภทการลา'
    if (!isLate && !form.start_date) fe.date = 'กรุณาเลือกวันที่'
    setFieldErrors(fe)
    if (fe.type || fe.date) return
    if (!session?.user?.employeeId) return

    setError('')

    // Holiday check
    const conflictDate = checkHolidayConflict()
    if (conflictDate) {
      return setError(`วันที่ ${conflictDate} เป็นวันหยุดบริษัท ไม่สามารถยื่นลาได้`)
    }

    // Quota check
    const quotaError = checkQuota()
    if (quotaError) {
      return setError(`โควต้าไม่เพียงพอ: ${quotaError}`)
    }

    // Payroll lockout check
    const lockedPeriod = await checkPayrollLockout()
    if (lockedPeriod) {
      return setError(`รอบ "${lockedPeriod}" ปิดแล้ว ไม่สามารถยื่นลาย้อนหลังได้ กรุณาติดต่อ HR`)
    }

    setSubmitting(true)

    const today = todayISO()
    const payload = {
      employee_id: session.user.employeeId,
      leave_type_id: form.leave_type_id,
      start_date: isLate ? today : form.start_date,
      end_date: isLate ? today : (form.end_date || form.start_date),
      total_days: isLate ? 0 : calcDays(),
      late_minutes: isLate ? form.late_minutes : 0,
      reason: form.reason || null,
      status: 'pending',
      current_approval_level: 1,
    }

    const { data: inserted, error: err } = await supabase
      .from('leave_requests')
      .insert(payload)
      .select('id')
      .single()

    if (err) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setSubmitting(false)
      return
    }

    // แจ้งเตือน LINE ไปยังผู้อนุมัติ (ไม่บล็อกการนำทางถ้าพลาด)
    if (inserted?.id) {
      fetch('/api/notify/new-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'leave', requestId: inserted.id }),
      }).catch(() => {})
    }

    router.push('/dashboard')
  }

  const getQuotaBar = (used: number, total: number) => {
    const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
    const color = pct >= 80 ? 'bg-red-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-green-400'
    return { pct, color, remaining: total - used }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ยื่นคำขอลา" />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* โควต้าการลา */}
        {quota && (
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">โควต้าการลาปีนี้</p>
            <div className="space-y-2.5">
              {[
                { label: 'ลาป่วย', used: usage.sick, total: quota.sick_leave_quota },
                { label: 'ลากิจ', used: usage.personal, total: quota.personal_leave_quota },
                { label: 'ลาพักร้อน', used: usage.vacation, total: quota.vacation_leave_quota },
              ].map(item => {
                const { pct, color, remaining } = getQuotaBar(item.used, item.total)
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>{item.label}</span>
                      <span className="font-medium">เหลือ {remaining}/{item.total} วัน</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ประเภทการลา */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทการลา</label>
          <select
            value={form.leave_type_id}
            onChange={e => { setForm({ ...form, leave_type_id: e.target.value }); setFieldErrors(fe => ({ ...fe, type: undefined })) }}
            className={`w-full border rounded-lg px-3 py-2.5 min-h-11 text-gray-800 bg-white ${fieldErrors.type ? 'border-red-400' : 'border-gray-300'}`}
          >
            <option value="">เลือกประเภท</option>
            {leaveTypes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <FieldError message={fieldErrors.type} />
        </div>

        {/* มาสาย */}
        {isLate && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนนาทีที่สาย</label>
            <input
              type="number"
              value={form.late_minutes}
              onChange={e => setForm({ ...form, late_minutes: parseInt(e.target.value) || 0 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              placeholder="นาที"
              min={1}
            />
          </div>
        )}

        {/* วันที่ */}
        {!isLate && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่เริ่ม</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => { setForm({ ...form, start_date: e.target.value, end_date: e.target.value }); setFieldErrors(fe => ({ ...fe, date: undefined })) }}
                className={`w-full border rounded-lg px-3 py-2.5 min-h-11 text-gray-800 ${fieldErrors.date ? 'border-red-400' : 'border-gray-300'}`}
              />
              <FieldError message={fieldErrors.date} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่สิ้นสุด</label>
              <input
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              />
            </div>
            {form.start_date && form.end_date && (
              <p className="text-sm text-blue-600 font-medium">รวม {calcDays()} วัน</p>
            )}
          </>
        )}

        {/* เหตุผล */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผล (ถ้ามี)</label>
          <textarea
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800 resize-none"
            placeholder="ระบุเหตุผล..."
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <Button variant="primary" fullWidth onClick={handleSubmit} disabled={submitting} className="py-3">
          {submitting ? 'กำลังส่ง...' : 'ส่งคำขอลา'}
        </Button>
      </div>
    </div>
  )
}