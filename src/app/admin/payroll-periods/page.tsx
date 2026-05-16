'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface PayrollPeriod {
  id: string
  period_name: string
  start_date: string
  end_date: string
  period_type: string
  is_locked: boolean
  locked_at: string | null
  locked_by: string | null
}

export default function PayrollPeriodsPage() {
  const router = useRouter()
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    period_name: '',
    start_date: '',
    end_date: '',
    period_type: 'daily_1',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { fetchPeriods() }, [])

  async function fetchPeriods() {
    const { data } = await supabase
      .from('payroll_periods')
      .select('*')
      .order('start_date', { ascending: false })
    setPeriods(data || [])
    setLoading(false)
  }

  async function toggleLock(period: PayrollPeriod) {
    const confirm = window.confirm(
      period.is_locked
        ? `เปิดรอบ "${period.period_name}" อีกครั้ง?`
        : `ปิดรอบ "${period.period_name}"? พนักงานจะไม่สามารถยื่นลาหรือแก้ไขข้อมูลย้อนหลังได้`
    )
    if (!confirm) return

    await supabase
      .from('payroll_periods')
      .update({
        is_locked: !period.is_locked,
        locked_at: !period.is_locked ? new Date().toISOString() : null,
      })
      .eq('id', period.id)
    await fetchPeriods()
  }

  async function handleAdd() {
    if (!form.period_name || !form.start_date || !form.end_date) return
    setSubmitting(true)
    await supabase.from('payroll_periods').insert({
      period_name: form.period_name,
      start_date: form.start_date,
      end_date: form.end_date,
      period_type: form.period_type,
      is_locked: false,
    })
    setForm({ period_name: '', start_date: '', end_date: '', period_type: 'daily_1' })
    setShowForm(false)
    await fetchPeriods()
    setSubmitting(false)
  }

  const typeLabel: Record<string, string> = {
    daily_1: 'รายวัน งวด 1',
    daily_2: 'รายวัน งวด 2',
    monthly: 'รายเดือน',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400">←</button>
          <h1 className="font-semibold text-gray-800">รอบ Payroll</h1>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg">
          + เพิ่มรอบ
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* ฟอร์มเพิ่มรอบ */}
        {showForm && (
          <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-3">
            <p className="font-medium text-gray-800 text-sm">เพิ่มรอบ Payroll</p>
            <input
              type="text"
              value={form.period_name}
              onChange={e => setForm({ ...form, period_name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800"
              placeholder="เช่น รายวัน งวด 1 มิ.ย. 69"
            />
            <select
              value={form.period_type}
              onChange={e => setForm({ ...form, period_type: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
            >
              <option value="daily_1">รายวัน งวด 1</option>
              <option value="daily_2">รายวัน งวด 2</option>
              <option value="monthly">รายเดือน</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">วันเริ่มต้น</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">วันสิ้นสุด</label>
                <input type="date" value={form.end_date} min={form.start_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <button onClick={handleAdd} disabled={submitting} className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm disabled:opacity-50">
              {submitting ? 'กำลังบันทึก...' : 'เพิ่มรอบ'}
            </button>
          </div>
        )}

        {/* รายการรอบ */}
        <div className="space-y-2">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">กำลังโหลด...</p>
          ) : periods.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">ยังไม่มีรอบ Payroll</p>
          ) : (
            periods.map(p => (
              <div key={p.id} className={`bg-white rounded-xl p-4 border ${p.is_locked ? 'border-red-100' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{p.period_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{p.start_date} ถึง {p.end_date}</p>
                    <p className="text-xs text-gray-400">{typeLabel[p.period_type]}</p>
                    {p.is_locked && p.locked_at && (
                      <p className="text-xs text-red-400 mt-0.5">
                        ปิดเมื่อ {new Date(p.locked_at).toLocaleDateString('th-TH')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${p.is_locked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {p.is_locked ? '🔒 ปิดแล้ว' : '🔓 เปิดอยู่'}
                    </span>
                    <button
                      onClick={() => toggleLock(p)}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${p.is_locked ? 'border-green-300 text-green-600' : 'border-red-300 text-red-500'}`}
                    >
                      {p.is_locked ? 'เปิดรอบ' : 'ปิดรอบ'}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="bg-yellow-50 rounded-xl p-3 border border-yellow-100">
          <p className="text-xs text-yellow-700">
            เมื่อปิดรอบแล้ว พนักงานจะไม่สามารถยื่นลาหรือแก้ไข Work Log ย้อนหลังในช่วงเวลานั้นได้
          </p>
        </div>
      </div>
    </div>
  )
}