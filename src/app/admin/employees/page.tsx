'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, Button } from '@/components/ui'

interface Row {
  id: string
  name: string
  subtitle: string
  line_user_id: string | null
}

interface RegRequest {
  id: string
  line_user_id: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  created_at: string
}

type Tab = 'emp' | 'appr'

export default function EmployeeLineBindingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('emp')
  const [employees, setEmployees] = useState<Row[]>([])
  const [approvers, setApprovers] = useState<Row[]>([])
  const [regs, setRegs] = useState<RegRequest[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [regTarget, setRegTarget] = useState<Record<string, string>>({})
  const [regBusyId, setRegBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) {
      router.replace('/dashboard')
      return
    }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const [empRes, apprRes, regRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, employee_code, name, position, line_user_id')
          .eq('is_active', true)
          .order('employee_code'),
        supabase
          .from('approvers')
          .select('id, name, email, line_user_id')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('registration_requests')
          .select('id, line_user_id, first_name, last_name, display_name, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ])
      if (empRes.error) throw empRes.error
      if (apprRes.error) throw apprRes.error
      // registration_requests อาจยังไม่มีตาราง (ยังไม่รัน migration) — ไม่ให้ล้มทั้งหน้า
      if (!regRes.error) setRegs((regRes.data || []) as RegRequest[])

      setEmployees(
        (empRes.data || []).map(e => ({
          id: e.id,
          name: e.name,
          subtitle: `${e.employee_code} · ${e.position || ''}`,
          line_user_id: e.line_user_id,
        }))
      )
      setApprovers(
        (apprRes.data || []).map(a => ({
          id: a.id,
          name: a.name,
          subtitle: a.email || 'ผู้อนุมัติ',
          line_user_id: a.line_user_id,
        }))
      )
    } catch (e) {
      console.error('fetch employees error:', e)
      setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function save(table: 'employees' | 'approvers', row: Row) {
    const raw = drafts[row.id]
    const val = (raw ?? '').trim()
    setSavingId(row.id)
    setError('')
    try {
      const { error } = await supabase
        .from(table)
        .update({ line_user_id: val || null })
        .eq('id', row.id)
      if (error) throw error

      // อัปเดตค่าในหน้าจอ
      const updater = (rows: Row[]) => rows.map(r => (r.id === row.id ? { ...r, line_user_id: val || null } : r))
      if (table === 'employees') setEmployees(updater)
      else setApprovers(updater)

      setDrafts(d => {
        const next = { ...d }
        delete next[row.id]
        return next
      })
      setSavedId(row.id)
      setTimeout(() => setSavedId(s => (s === row.id ? null : s)), 2000)
    } catch (e) {
      console.error('save line_user_id error:', e)
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSavingId(null)
    }
  }

  // ผูกคำขอลงทะเบียนกับพนักงานที่เลือก: เซ็ต line_user_id ให้พนักงาน + ปิดคำขอ
  async function bindReg(reg: RegRequest) {
    const empId = regTarget[reg.id]
    if (!empId) {
      setError('กรุณาเลือกพนักงานที่จะผูกก่อน')
      return
    }
    setRegBusyId(reg.id)
    setError('')
    try {
      const { error: empErr } = await supabase
        .from('employees')
        .update({ line_user_id: reg.line_user_id })
        .eq('id', empId)
      if (empErr) throw empErr

      const { error: regErr } = await supabase
        .from('registration_requests')
        .update({ status: 'linked', updated_at: new Date().toISOString() })
        .eq('id', reg.id)
      if (regErr) throw regErr

      // อัปเดตหน้าจอ: ใส่ line_user_id ให้พนักงานในลิสต์ + ลบคำขอออก
      setEmployees(rows => rows.map(r => (r.id === empId ? { ...r, line_user_id: reg.line_user_id } : r)))
      setRegs(rs => rs.filter(r => r.id !== reg.id))
      setRegTarget(t => {
        const next = { ...t }
        delete next[reg.id]
        return next
      })
    } catch (e) {
      console.error('bind reg error:', e)
      setError('ผูกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setRegBusyId(null)
    }
  }

  // คำขอที่ไม่ใช่พนักงานจริง — ปิดทิ้ง
  async function dismissReg(reg: RegRequest) {
    setRegBusyId(reg.id)
    setError('')
    try {
      const { error } = await supabase
        .from('registration_requests')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('id', reg.id)
      if (error) throw error
      setRegs(rs => rs.filter(r => r.id !== reg.id))
    } catch (e) {
      console.error('dismiss reg error:', e)
      setError('ปิดคำขอไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setRegBusyId(null)
    }
  }

  if (status === 'loading' || !session?.user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    )
  }

  const rows = tab === 'emp' ? employees : approvers
  const table = tab === 'emp' ? 'employees' : 'approvers'
  const boundCount = rows.filter(r => r.line_user_id).length

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="ผูก Line ID" subtitle="สำหรับแจ้งเตือนผ่าน LINE" onBack={() => router.push('/admin')} />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* คำอธิบาย */}
        <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
          <p className="text-xs text-blue-800">
            ให้พนักงาน/หัวหน้าเข้าแอปด้วย LINE แล้วกด “คัดลอก Line ID” ส่งมาให้ HR
            จากนั้นวางลงในช่องของคนนั้นแล้วกดบันทึก
          </p>
        </div>

        {/* คำขอลงทะเบียนใหม่ (พนักงานกรอกชื่อ+ส่ง LINE ID เข้ามาเอง) */}
        {regs.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">📝 คำขอลงทะเบียนใหม่ ({regs.length})</h2>
            <div className="space-y-2">
              {regs.map(reg => {
                const fullName = [reg.first_name, reg.last_name].filter(Boolean).join(' ') || reg.display_name || '(ไม่ระบุชื่อ)'
                return (
                  <div key={reg.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-sm font-medium text-gray-800">{fullName}</p>
                    {reg.display_name && reg.display_name !== fullName && (
                      <p className="text-xs text-gray-400">ชื่อ LINE: {reg.display_name}</p>
                    )}
                    <p className="text-xs font-mono text-gray-500 break-all mt-1 select-all">{reg.line_user_id}</p>

                    {/* เลือกพนักงานที่จะผูก แล้วกดผูกในคลิกเดียว */}
                    <select
                      value={regTarget[reg.id] || ''}
                      onChange={e => setRegTarget(t => ({ ...t, [reg.id]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-sm text-gray-800 bg-white mt-2"
                    >
                      <option value="">เลือกพนักงานที่จะผูก...</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.subtitle}){emp.line_user_id ? ' · ผูกแล้ว' : ''}
                        </option>
                      ))}
                    </select>

                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="primary"
                        onClick={() => bindReg(reg)}
                        disabled={regBusyId === reg.id || !regTarget[reg.id]}
                        className="flex-1"
                      >
                        {regBusyId === reg.id ? '...' : '🔗 ผูกกับพนักงานนี้'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => dismissReg(reg)}
                        disabled={regBusyId === reg.id}
                        className="shrink-0"
                      >
                        ไม่ใช่พนักงาน
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              เลือกพนักงานที่ตรงกับคำขอ แล้วกด “ผูกกับพนักงานนี้” ระบบจะตั้งค่า Line ID ให้อัตโนมัติ
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab('emp')}
            className={`flex-1 py-2 min-h-11 rounded-lg text-sm font-medium transition ${tab === 'emp' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
          >
            พนักงาน ({employees.filter(r => r.line_user_id).length}/{employees.length})
          </button>
          <button
            onClick={() => setTab('appr')}
            className={`flex-1 py-2 min-h-11 rounded-lg text-sm font-medium transition ${tab === 'appr' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
          >
            ผู้อนุมัติ ({approvers.filter(r => r.line_user_id).length}/{approvers.length})
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={fetchData} className="text-red-600 text-sm underline shrink-0 ml-2">ลองใหม่</button>
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-400 py-8">ไม่มีข้อมูล</p>
        ) : (
          <>
            <p className="text-xs text-gray-400">ผูกแล้ว {boundCount}/{rows.length} คน</p>
            <div className="space-y-2">
              {rows.map(row => {
                const draft = drafts[row.id]
                const current = row.line_user_id || ''
                const value = draft ?? current
                const dirty = draft !== undefined && draft.trim() !== current
                const looksValid = value.trim() === '' || value.trim().startsWith('U')
                return (
                  <div key={row.id} className="bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{row.name}</p>
                        <p className="text-xs text-gray-400 truncate">{row.subtitle}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${row.line_user_id ? 'bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]' : 'bg-[var(--color-neutral-bg)] text-[var(--color-neutral-fg)]'}`}>
                        {row.line_user_id ? 'ผูกแล้ว' : 'ยังไม่ผูก'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={value}
                        onChange={e => setDrafts(d => ({ ...d, [row.id]: e.target.value }))}
                        placeholder="วาง Line ID (ขึ้นต้นด้วย U...)"
                        className={`flex-1 min-w-0 border rounded-lg px-3 py-2 min-h-11 text-sm font-mono text-gray-800 ${!looksValid ? 'border-amber-400' : 'border-gray-300'}`}
                      />
                      <Button
                        variant="primary"
                        onClick={() => save(table, row)}
                        disabled={!dirty || savingId === row.id}
                        className="px-4 shrink-0"
                      >
                        {savingId === row.id ? '...' : savedId === row.id ? '✓' : 'บันทึก'}
                      </Button>
                    </div>
                    {!looksValid && (
                      <p className="text-amber-600 text-xs mt-1">Line ID มักขึ้นต้นด้วยตัว U — ตรวจสอบอีกครั้ง</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
          <p className="text-xs text-amber-700">
            หมายเหตุ: Line ID ต้องเป็น userId ของ channel Messaging API และผู้ใช้ต้องแอด LINE OA
            เป็นเพื่อนแล้ว การแจ้งเตือนจึงจะส่งถึง
          </p>
        </div>
      </div>
    </div>
  )
}
