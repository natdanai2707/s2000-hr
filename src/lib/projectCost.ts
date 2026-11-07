// คำนวณต้นทุนแรงงานต่อโปรเจกต์ จาก work_logs + เรทพนักงาน
// ใช้สูตรชั่วโมง/OT เดียวกับ payroll export (OT = 1.5x) — ไม่แตะ logic เดิม

export interface EmpRate {
  id: string
  employee_code?: string
  name?: string
  employee_type: 'daily' | 'monthly'
  daily_rate: number | null
  monthly_salary: number | null
}

export interface WorkLogRow {
  employee_id: string
  project_id: string | null
  log_date: string
  hours_spent: number | null
  ot_hours: number | null
  water_allowance: number | null
  daily_allowance: number | null
  other_income: number | null
  project?: { project_code: string; project_name: string } | null
}

export interface ProjectCost {
  projectId: string
  projectCode: string
  projectName: string
  workers: number
  totalHours: number
  totalOtHours: number
  laborCost: number
  otCost: number
  allowance: number
  total: number
}

export function hourlyRate(emp: EmpRate): number {
  if (emp.employee_type === 'daily') return (emp.daily_rate || 0) / 8
  return (emp.monthly_salary || 0) / 30 / 8
}

export function entryCost(log: WorkLogRow, emp: EmpRate | undefined) {
  const hr = emp ? hourlyRate(emp) : 0
  const labor = (log.hours_spent || 0) * hr
  const ot = (log.ot_hours || 0) * hr * 1.5
  const allowance = (log.water_allowance || 0) + (log.daily_allowance || 0) + (log.other_income || 0)
  return { labor, ot, allowance, total: labor + ot + allowance }
}

const NO_PROJECT = '__none__'

export function aggregateByProject(logs: WorkLogRow[], empMap: Map<string, EmpRate>): ProjectCost[] {
  const map = new Map<string, ProjectCost & { workerSet: Set<string> }>()

  for (const log of logs) {
    const key = log.project_id || NO_PROJECT
    if (!map.has(key)) {
      map.set(key, {
        projectId: key,
        projectCode: log.project?.project_code || (key === NO_PROJECT ? '-' : key.slice(0, 8)),
        projectName: log.project?.project_name || (key === NO_PROJECT ? 'ไม่ระบุงาน' : ''),
        workers: 0,
        totalHours: 0,
        totalOtHours: 0,
        laborCost: 0,
        otCost: 0,
        allowance: 0,
        total: 0,
        workerSet: new Set<string>(),
      })
    }
    const row = map.get(key)!
    const c = entryCost(log, empMap.get(log.employee_id))
    row.totalHours += log.hours_spent || 0
    row.totalOtHours += log.ot_hours || 0
    row.laborCost += c.labor
    row.otCost += c.ot
    row.allowance += c.allowance
    row.total += c.total
    row.workerSet.add(log.employee_id)
  }

  const result = [...map.values()].map(r => {
    r.workers = r.workerSet.size
    const { workerSet, ...rest } = r
    void workerSet
    return rest
  })
  // งานที่มีต้นทุนมากสุดก่อน, "ไม่ระบุงาน" ไว้ท้าย
  result.sort((a, b) => {
    if (a.projectId === NO_PROJECT) return 1
    if (b.projectId === NO_PROJECT) return -1
    return b.total - a.total
  })
  return result
}
