'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, Button, FieldError } from '@/components/ui'

interface Employee {
  id: string
  employee_code: string
  name: string
  position: string | null
  employee_type: 'daily' | 'monthly'
  daily_rate: number | null
  monthly_salary: number | null
  sick_leave_quota: number | null
  personal_leave_quota: number | null
  vacation_leave_quota: number | null
  start_date: string | null
  line_user_id: string | null
  is_active: boolean
}

const emptyForm = () => ({
  employee_code: '',
  name: '',
  position: '',
  employee_type: 'daily' as 'daily' | 'monthly',
  daily_rate: '',
  monthly_salary: '',
  sick_leave_quota: '30',
  personal_leave_quota: '3',
  vacation_leave_quota: '6',
  start_date: '',
  line_user_id: '',
  is_active: true,
})

export default function StaffPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [list, setList] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) { router.replace('/dashboard'); return }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status])

  async function fetchData() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('employee_code')
      if (error) throw error
      setList((data || []) as Employee[])
    } catch (e) {
      console.error('fetch staff error:', e)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setForm(emptyForm())
    setEditingId(null)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setForm({
      employee_code: emp.employee_code || '',
      name: emp.name || '',
      position: emp.position || '',
      employee_type: emp.employee_type === 'monthly' ? 'monthly' : 'daily',
      daily_rate: emp.daily_rate?.toString() || '',
      monthly_salary: emp.monthly_salary?.toString() || '',
      sick_leave_quota: (emp.sick_leave_quota ?? 0).toString(),
      personal_leave_quota: (emp.personal_leave_quota ?? 0).toString(),
      vacation_leave_quota: (emp.vacation_leave_quota ?? 0).toString(),
      start_date: emp.start_date || '',
      line_user_id: emp.line_user_id || '',
      is_active: emp.is_active,
    })
    setEditingId(emp.id)
    setFormError('')
    setShowForm(true)
  }

  async function handleSubmit() {
    if (!form.employee_code.trim()) return setFormError('กรุณากรอกรหัสพนักงาน')
    if (!form.name.trim()) return setFormError('กรุณากรอกชื่อ-สกุล')
    setSubmitting(true)
    setFormError('')

    const num = (s: string) => (s.trim() === '' ? null : parseFloat(s))
    const intNum = (s: string) => (s.trim() === '' ? 0 : parseInt(s) || 0)

    const payload = {
      employee_code: form.employee_code.trim(),
      name: form.name.trim(),
      position: form.position.trim() || null,
      employee_type: form.employee_type,
      daily_rate: form.employee_type === 'daily' ? num(form.daily_rate) : null,
      monthly_salary: form.employee_type === 'monthly' ? num(form.monthly_salary) : null,
      sick_leave_quota: intNum(form.sick_leave_quota),
      personal_leave_quota: intNum(form.personal_leave_quota),
      vacation_leave_quota: intNum(form.vacation_leave_quota),
      start_date: form.start_date || null,
      line_user_id: form.line_user_id.trim() || null,
      is_active: form.is_active,
    }

    try {
      const { error } = editingId
        ? await supabase.from('employees').update(payload).eq('id', editingId)
        : await supabase.from('employees').insert(payload)
      if (error) {
        if (error.code === '23505') throw new Error('รหัสพนักงานนี้มีอยู่แล้ว')
        throw error
      }
      await fetchData()
      setShowForm(false)
    } catch (e: any) {
      console.error('save staff error:', e)
      setFormError(e?.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(emp: Employee) {
    try {
      const { error } = await supabase.from('employees').update({ is_active: !emp.is_active }).eq('id', emp.id)
      if (error) throw error
      await fetchData()
    } catch (e) {
      console.error('toggle active error:', e)
      alert('เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่')
    }
  }

  if (status === 'loading' || !session?.user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p></div>
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800'

  if (showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title={editingId ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'} onBack={() => setShowForm(false)} />
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">รหัสพนักงาน *</label>
              <input value={form.employee_code} onChange={e => setForm({ ...form, employee_code: e.target.value })} className={inputCls} placeholder="เช่น 001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันเริ่มงาน</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-สกุล *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="เช่น สมชาย ใจดี" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ตำแหน่ง</label>
            <input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} className={inputCls} placeholder="เช่น ช่างเชื่อม" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทการจ้าง</label>
            <div className="grid grid-cols-2 gap-2">
              {(['daily', 'monthly'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setForm({ ...form, employee_type: t })}
                  className={`rounded-xl py-2.5 min-h-11 text-sm border transition ${form.employee_type === t ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600'}`}
                >
                  {t === 'daily' ? 'รายวัน' : 'รายเดือน'}
                </button>
              ))}
            </div>
          </div>

          {form.employee_type === 'daily' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ค่าแรง/วัน (บาท)</label>
              <input type="number" inputMode="decimal" value={form.daily_rate} onChange={e => setForm({ ...form, daily_rate: e.target.value })} className={inputCls} placeholder="0" min={0} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เงินเดือน (บาท)</label>
              <input type="number" inputMode="decimal" value={form.monthly_salary} onChange={e => setForm({ ...form, monthly_salary: e.target.value })} className={inputCls} placeholder="0" min={0} />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">โควต้าการลา (วัน/ปี)</label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-gray-400 mb-1">ลาป่วย</p>
                <input type="number" value={form.sick_leave_quota} onChange={e => setForm({ ...form, sick_leave_quota: e.target.value })} className={inputCls} min={0} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">ลากิจ</p>
                <input type="number" value={form.personal_leave_quota} onChange={e => setForm({ ...form, personal_leave_quota: e.target.value })} className={inputCls} min={0} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">พักร้อน</p>
                <input type="number" value={form.vacation_leave_quota} onChange={e => setForm({ ...form, vacation_leave_quota: e.target.value })} className={inputCls} min={0} />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Line ID (ถ้ามี)</label>
            <input value={form.line_user_id} onChange={e => setForm({ ...form, line_user_id: e.target.value })} className={`${inputCls} font-mono text-sm`} placeholder="Uxxxxxxxx..." />
          </div>

          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-5 h-5" />
            <span className="text-sm text-gray-700">เปิดใช้งาน (พนักงานปัจจุบัน)</span>
          </label>

          <FieldError message={formError} />

          <Button variant="primary" fullWidth onClick={handleSubmit} disabled={submitting} className="py-3">
            {submitting ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน'}
          </Button>
        </div>
      </div>
    )
  }

  const visible = list.filter(e => showInactive || e.is_active)

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="จัดการพนักงาน & เรท"
        onBack={() => router.push('/admin')}
        right={<Button variant="primary" onClick={openNew} className="px-3">+ เพิ่ม</Button>}
      />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="w-4 h-4" />
          แสดงพนักงานที่ปิดใช้งานด้วย
        </label>

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : visible.length === 0 ? (
          <p className="text-center text-gray-400 py-8">ยังไม่มีพนักงาน</p>
        ) : (
          visible.map(emp => (
            <div key={emp.id} className={`bg-white rounded-xl p-3 border ${emp.is_active ? 'border-gray-100' : 'border-gray-200 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {emp.name} <span className="text-gray-400 font-normal">({emp.employee_code})</span>
                  </p>
                  <p className="text-xs text-gray-400">{emp.position || '-'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {emp.employee_type === 'daily'
                      ? `รายวัน · ${emp.daily_rate ? emp.daily_rate.toLocaleString() : '—'} บ./วัน`
                      : `รายเดือน · ${emp.monthly_salary ? emp.monthly_salary.toLocaleString() : '—'} บ.`}
                    {!emp.line_user_id && <span className="text-amber-500"> · ยังไม่ผูก LINE</span>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0 ml-2">
                  <button onClick={() => openEdit(emp)} className="text-xs text-blue-500 border border-blue-200 px-2 py-1 rounded-lg min-h-8">แก้ไข</button>
                  <button onClick={() => toggleActive(emp)} className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg min-h-8">{emp.is_active ? 'ปิด' : 'เปิด'}</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
