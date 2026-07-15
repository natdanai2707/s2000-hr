// การคำนวณสลิปเงินเดือน (read-only) — ใช้สูตรเดียวกับไฟล์ export payroll
// สำคัญ: ห้ามเปลี่ยนตัวคูณ OT (1.5x) และ ปกส. 3% cap 750 — ให้ตรงกับ Excel ที่ HR ใช้จ่ายจริง

export interface PayslipInput {
  employeeType: 'daily' | 'monthly'
  dailyRate: number
  monthlySalary: number
  logs: Array<{ log_date: string; ot_hours?: number | null; daily_allowance?: number | null; water_allowance?: number | null }>
  leaves: Array<{ total_days: number; late_minutes?: number | null; leave_type?: { code?: string; is_paid?: boolean } | null }>
}

export interface PayslipResult {
  workDays: number
  basePay: number
  totalOtHours: number
  otPay: number
  totalAllowance: number
  totalWater: number
  grossPay: number
  sso: number
  lateMinutes: number
  lateDeduct: number
  absentDays: number
  unpaidLeaveDays: number
  absentDeduct: number
  netPay: number
}

export function computePayslip(input: PayslipInput): PayslipResult {
  const { employeeType, dailyRate, monthlySalary, logs, leaves } = input
  const isDaily = employeeType === 'daily'

  const totalOtHours = logs.reduce((s, l) => s + (l.ot_hours || 0), 0)
  const totalAllowance = logs.reduce((s, l) => s + (l.daily_allowance || 0), 0)
  const totalWater = logs.reduce((s, l) => s + (l.water_allowance || 0), 0)

  const lateMinutes = leaves
    .filter(l => l.leave_type?.code === 'LATE')
    .reduce((s, l) => s + (l.late_minutes || 0), 0)
  const absentDays = leaves
    .filter(l => l.leave_type?.code === 'ABSENT')
    .reduce((s, l) => s + l.total_days, 0)
  const unpaidLeaveDays = leaves
    .filter(l => !l.leave_type?.is_paid)
    .filter(l => l.leave_type?.code !== 'ABSENT')
    .reduce((s, l) => s + l.total_days, 0)

  // วันทำงานจริง = จำนวนวันที่ไม่ซ้ำที่มี work log
  const workDays = new Set(logs.map(l => l.log_date)).size

  const basePay = isDaily ? dailyRate * workDays : monthlySalary
  const hourlyRate = isDaily ? dailyRate / 8 : monthlySalary / 30 / 8
  const otPay = hourlyRate * 1.5 * totalOtHours
  const lateDeduct = hourlyRate * (lateMinutes / 60)
  const absentDeduct = isDaily
    ? dailyRate * (absentDays + unpaidLeaveDays)
    : (monthlySalary / 30) * (absentDays + unpaidLeaveDays)

  const grossPay = basePay + otPay + totalAllowance + totalWater
  const sso = Math.min(grossPay * 0.03, 750)
  const netPay = grossPay - sso - lateDeduct - absentDeduct

  return {
    workDays,
    basePay,
    totalOtHours,
    otPay,
    totalAllowance,
    totalWater,
    grossPay,
    sso,
    lateMinutes,
    lateDeduct,
    absentDays,
    unpaidLeaveDays,
    absentDeduct,
    netPay,
  }
}

// จัดรูปแบบเงินบาท
export function formatBaht(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
