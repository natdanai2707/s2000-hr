'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader, EmptyState } from '@/components/ui'
import { currentMonthISO, monthRange, formatThaiDate } from '@/lib/date'
import { computePayslip, formatBaht, PayslipResult } from '@/lib/payroll'

export default function PayslipPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonthISO())
  const [result, setResult] = useState<PayslipResult | null>(null)
  const [empName, setEmpName] = useState('')
  const [empType, setEmpType] = useState<'daily' | 'monthly'>('daily')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [noRate, setNoRate] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return }
    if (session?.user?.employeeId) fetchPayslip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, month, status])

  async function fetchPayslip() {
    setLoading(true)
    setError('')
    try {
      const empId = session!.user.employeeId!
      const { start, end } = monthRange(month)

      const [empRes, logsRes, leavesRes] = await Promise.all([
        supabase.from('employees').select('name, employee_type, daily_rate, monthly_salary').eq('id', empId).single(),
        supabase.from('work_logs').select('log_date, ot_hours, daily_allowance, water_allowance').eq('employee_id', empId).gte('log_date', start).lte('log_date', end),
        supabase.from('leave_requests').select('total_days, late_minutes, leave_type:leave_types(code, is_paid)').eq('employee_id', empId).eq('status', 'approved').gte('start_date', start).lte('end_date', end),
      ])

      if (empRes.error) throw empRes.error
      const emp = empRes.data
      if (!emp) throw new Error('ไม่พบข้อมูลพนักงาน')

      setEmpName(emp.name)
      const type = (emp.employee_type === 'monthly' ? 'monthly' : 'daily') as 'daily' | 'monthly'
      setEmpType(type)

      const dailyRate = emp.daily_rate || 0
      const monthlySalary = emp.monthly_salary || 0
      setNoRate(type === 'daily' ? dailyRate === 0 : monthlySalary === 0)

      const res = computePayslip({
        employeeType: type,
        dailyRate,
        monthlySalary,
        logs: logsRes.data || [],
        leaves: (leavesRes.data || []) as any,
      })
      setResult(res)
    } catch (e) {
      console.error('payslip error:', e)
      setError('โหลดสลิปไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังโหลด...</p></div>
  }

  const monthLabel = formatThaiDate(`${month}-01`, { month: 'long', year: 'numeric' })

  const Row = ({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) => (
    <div className="flex justify-between items-center py-1.5">
      <span className={`text-sm ${strong ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${strong ? 'font-semibold' : ''} ${minus ? 'text-red-500' : 'text-gray-800'}`}>
        {minus ? '-' : ''}{formatBaht(value)}
      </span>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="สลิปเงินเดือน" subtitle="ดูย้อนหลังได้ทุกเดือน" onBack={() => router.push('/dashboard')} />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">เลือกเดือน</label>
          <input
            type="month"
            value={month}
            max={currentMonthISO()}
            onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 min-h-11 text-sm text-gray-800 bg-white"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : result && (result.grossPay > 0 || result.workDays > 0) ? (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* หัวสลิป */}
            <div className="bg-brand-600 text-white px-4 py-4">
              <p className="text-sm opacity-90">บริษัท เอส-2000 สตีล แฟบริเคท จำกัด</p>
              <p className="font-semibold text-lg">{empName}</p>
              <p className="text-sm opacity-90">{monthLabel} · {empType === 'daily' ? 'รายวัน' : 'รายเดือน'}</p>
            </div>

            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 mb-1">รายได้</p>
              <Row label={empType === 'daily' ? `ค่าแรง (${result.workDays} วัน)` : 'เงินเดือน'} value={result.basePay} />
              <Row label={`ค่า OT (${result.totalOtHours} ชม. × 1.5)`} value={result.otPay} />
              {result.totalAllowance > 0 && <Row label="เบี้ยเลี้ยง" value={result.totalAllowance} />}
              {result.totalWater > 0 && <Row label="ค่าน้ำ" value={result.totalWater} />}
              <div className="border-t border-gray-100 mt-1">
                <Row label="รวมเงินได้" value={result.grossPay} strong />
              </div>

              <p className="text-xs font-semibold text-gray-400 mt-3 mb-1">รายการหัก</p>
              <Row label="ประกันสังคม (3% สูงสุด 750)" value={result.sso} minus />
              {result.lateMinutes > 0 && <Row label={`หักมาสาย (${result.lateMinutes} นาที)`} value={result.lateDeduct} minus />}
              {(result.absentDays + result.unpaidLeaveDays) > 0 && (
                <Row label={`หักขาด/ลาไม่รับค่าจ้าง (${result.absentDays + result.unpaidLeaveDays} วัน)`} value={result.absentDeduct} minus />
              )}

              <div className="border-t-2 border-gray-200 mt-2 pt-2 flex justify-between items-center">
                <span className="font-semibold text-gray-800">เงินสุทธิ</span>
                <span className="font-bold text-lg text-brand-700 tabular-nums">{formatBaht(result.netPay)} บาท</span>
              </div>
            </div>

            <div className="bg-amber-50 px-4 py-2.5">
              <p className="text-[11px] text-amber-700">
                * เป็นยอดประมาณการจากบันทึกในระบบ ยอดจ่ายจริงยึดตามที่ HR ตรวจสอบและอนุมัติ
                {noRate && ' · ยังไม่ได้ตั้งค่าแรง/เงินเดือน กรุณาติดต่อ HR'}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState icon="🧾" title="ยังไม่มีข้อมูลเดือนนี้" hint="สลิปจะคำนวณจากบันทึกงานและการลาที่อนุมัติแล้วในเดือนที่เลือก" />
        )}
      </div>
    </div>
  )
}
