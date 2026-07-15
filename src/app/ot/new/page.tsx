'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/date'
import { Button, FieldError, PageHeader } from '@/components/ui'

export default function OTRequestPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [holidays, setHolidays] = useState<string[]>([])
  const [form, setForm] = useState({
    request_date: todayISO(),
    ot_start: '',
    ot_end: '',
    day_type: 'normal',
    work_description: '',
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ time?: string; desc?: string }>({})

  useEffect(() => {
    fetchHolidays()
  }, [])

  // auto detect day type เมื่อเลือกวันที่
  useEffect(() => {
    if (!form.request_date) return
    const date = new Date(form.request_date + 'T12:00:00')
    const day = date.getDay()
    if (holidays.includes(form.request_date)) {
      setForm(f => ({ ...f, day_type: 'holiday' }))
    } else if (day === 0 || day === 6) {
      setForm(f => ({ ...f, day_type: 'weekend' }))
    } else {
      setForm(f => ({ ...f, day_type: 'normal' }))
    }
  }, [form.request_date, holidays])

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

  function calcOtHours(): number {
    if (!form.ot_start || !form.ot_end) return 0
    const [sh, sm] = form.ot_start.split(':').map(Number)
    const [eh, em] = form.ot_end.split(':').map(Number)
    let startMin = sh * 60 + sm
    let endMin = eh * 60 + em
    if (endMin <= startMin) endMin += 24 * 60 // ข้ามคืน
    return Math.round(((endMin - startMin) / 60) * 2) / 2 // round to 0.5
  }

  function getMultiplier(): number {
    if (form.day_type === 'holiday') return 3.0
    if (form.day_type === 'weekend') return 2.0
    return 1.5
  }

  function getDayTypeLabel(): string {
    if (form.day_type === 'holiday') return 'วันหยุดนักขัตฤกษ์ (3.0x)'
    if (form.day_type === 'weekend') return 'วันหยุดประจำสัปดาห์ (2.0x)'
    return 'วันทำงานปกติ (1.5x)'
  }

  function getDayTypeColor(): string {
    if (form.day_type === 'holiday') return 'bg-red-50 text-red-700 border-red-200'
    if (form.day_type === 'weekend') return 'bg-orange-50 text-orange-700 border-orange-200'
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }

  async function handleSubmit() {
    const fe: { time?: string; desc?: string } = {}
    if (!form.ot_start || !form.ot_end) fe.time = 'กรุณาระบุเวลาเริ่มและสิ้นสุด OT'
    if (!form.work_description) fe.desc = 'กรุณาระบุงานที่ทำ'
    setFieldErrors(fe)
    if (fe.time || fe.desc) return
    if (!session?.user?.employeeId) return

    setError('')
    const otHours = calcOtHours()
    if (otHours <= 0) {
      return setFieldErrors({ time: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น' })
    }

    // Payroll lockout check
    const { data: locked } = await supabase
      .from('payroll_periods')
      .select('period_name')
      .eq('is_locked', true)
      .lte('start_date', form.request_date)
      .gte('end_date', form.request_date)
      .limit(1)
      .maybeSingle()

    if (locked) {
      return setError(`รอบ "${locked.period_name}" ปิดแล้ว ไม่สามารถยื่น OT ย้อนหลังได้`)
    }

    setSubmitting(true)
    setError('')

    const multiplier = getMultiplier()
    const { error: err } = await supabase.from('ot_requests').insert({
      employee_id: session.user.employeeId,
      request_date: form.request_date,
      ot_start: form.ot_start,
      ot_end: form.ot_end,
      ot_hours: otHours,
      day_type: form.day_type,
      multiplier,
      ot_hours_multiplied: Math.round(otHours * multiplier * 2) / 2,
      work_description: form.work_description,
      reason: form.reason || null,
      status: 'pending',
      current_approval_level: 1,
    })

    if (err) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setSubmitting(false)
      return
    }

    router.push('/requests')
  }

  const otHours = calcOtHours()
  const multiplier = getMultiplier()

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ขอทำ OT" />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* กฎหมาย OT */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
          <p className="text-xs text-gray-500 font-medium mb-1">อัตรา OT ตามกฎหมาย (พ.ร.บ.คุ้มครองแรงงาน มาตรา 61)</p>
          <div className="grid grid-cols-3 gap-1 text-xs text-center">
            <div className="bg-blue-50 rounded-lg py-1.5 text-blue-700">
              <p className="font-bold">1.5x</p>
              <p>วันปกติ</p>
            </div>
            <div className="bg-orange-50 rounded-lg py-1.5 text-orange-700">
              <p className="font-bold">2.0x</p>
              <p>วันหยุด</p>
            </div>
            <div className="bg-red-50 rounded-lg py-1.5 text-red-700">
              <p className="font-bold">3.0x</p>
              <p>วันหยุดนักขัตฤกษ์</p>
            </div>
          </div>
        </div>

        {/* วันที่ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ทำ OT</label>
          <input
            type="date"
            value={form.request_date}
            onChange={e => setForm({ ...form, request_date: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
          />
        </div>

        {/* ประเภทวัน (auto detect แต่แก้ได้) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทวัน</label>
          <div className={`rounded-xl p-3 border mb-2 ${getDayTypeColor()}`}>
            <p className="text-sm font-medium">📅 {getDayTypeLabel()}</p>
            <p className="text-xs mt-0.5 opacity-70">ตรวจสอบอัตโนมัติจากวันที่เลือก</p>
          </div>
          <select
            value={form.day_type}
            onChange={e => setForm({ ...form, day_type: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800 bg-white text-sm"
          >
            <option value="normal">วันทำงานปกติ (1.5x)</option>
            <option value="weekend">วันหยุดประจำสัปดาห์ (2.0x)</option>
            <option value="holiday">วันหยุดนักขัตฤกษ์ (3.0x)</option>
          </select>
        </div>

        {/* เวลา OT */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เวลาเริ่ม OT</label>
            <input
              type="time"
              value={form.ot_start}
              onChange={e => setForm({ ...form, ot_start: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เวลาสิ้นสุด OT</label>
            <input
              type="time"
              value={form.ot_end}
              onChange={e => { setForm({ ...form, ot_end: e.target.value }); setFieldErrors(fe => ({ ...fe, time: undefined })) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
            />
          </div>
        </div>
        <FieldError message={fieldErrors.time} />

        {/* สรุป OT */}
        {otHours > 0 && (
          <div className="bg-green-50 rounded-xl p-3 border border-green-200">
            <p className="text-sm font-semibold text-green-800 mb-1">สรุปการคำนวณ OT</p>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <p className="text-xs text-gray-500">ชม. OT จริง</p>
                <p className="font-bold text-gray-800">{otHours} ชม.</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">ตัวคูณ</p>
                <p className="font-bold text-gray-800">{multiplier}x</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">ชม. OT คิดเงิน</p>
                <p className="font-bold text-green-700">{Math.round(otHours * multiplier * 2) / 2} ชม.</p>
              </div>
            </div>
          </div>
        )}

        {/* รายละเอียดงาน */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">งานที่ทำ *</label>
          <textarea
            value={form.work_description}
            onChange={e => { setForm({ ...form, work_description: e.target.value }); setFieldErrors(fe => ({ ...fe, desc: undefined })) }}
            rows={3}
            className={`w-full border rounded-lg px-3 py-2.5 text-gray-800 resize-none ${fieldErrors.desc ? 'border-red-400' : 'border-gray-300'}`}
            placeholder="อธิบายงานที่ทำในช่วง OT..."
          />
          <FieldError message={fieldErrors.desc} />
        </div>

        {/* เหตุผล */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผลที่ต้องทำ OT (ถ้ามี)</label>
          <input
            type="text"
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
            placeholder="เช่น งานเร่งด่วน ส่งลูกค้า"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <Button variant="primary" fullWidth onClick={handleSubmit} disabled={submitting} className="py-3">
          {submitting ? 'กำลังส่ง...' : 'ส่งคำขอ OT'}
        </Button>
      </div>
    </div>
  )
}