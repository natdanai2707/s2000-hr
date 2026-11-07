import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { auth } from '@/auth'
import { EmpRate, WorkLogRow, aggregateByProject, entryCost } from '@/lib/projectCost'
import { monthRange } from '@/lib/date'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const HEADER_BG = '1F4E79'
const SUB_BG = 'BDD7EE'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 })

  const { start, end } = monthRange(month)

  const [empRes, logsRes] = await Promise.all([
    supabase.from('employees').select('id, employee_code, name, employee_type, daily_rate, monthly_salary'),
    supabase
      .from('work_logs')
      .select('employee_id, project_id, log_date, hours_spent, ot_hours, water_allowance, daily_allowance, other_income, project:projects(project_code, project_name)')
      .gte('log_date', start)
      .lte('log_date', end)
      .order('log_date'),
  ])

  const employees = (empRes.data || []) as EmpRate[]
  const logs = (logsRes.data || []) as unknown as WorkLogRow[]
  const empMap = new Map(employees.map(e => [e.id, e]))

  const projects = aggregateByProject(logs, empMap)

  const thaiMonth = new Date(start).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'S-2000 HR'

  const headStyle = (cell: ExcelJS.Cell) => {
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }
  const borderAll = (cell: ExcelJS.Cell) => {
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }

  // ===== Sheet 1: สรุปต่อโปรเจกต์ =====
  const ws1 = wb.addWorksheet('สรุปต่องาน')
  ws1.mergeCells('A1:I1')
  const t1 = ws1.getCell('A1')
  t1.value = `รายงานต้นทุนแรงงานต่องาน ${thaiMonth} | บริษัท เอส-2000 สตีล แฟบริเคท จำกัด`
  t1.font = { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
  t1.alignment = { horizontal: 'center', vertical: 'middle' }
  ws1.getRow(1).height = 26

  const h1 = ['เลข Job', 'ชื่องาน', 'จำนวนคน', 'ชม.รวม', 'OT (ชม.)', 'ค่าแรง', 'ค่า OT', 'เบี้ยเลี้ยง/ค่าน้ำ/อื่นๆ', 'ต้นทุนรวม']
  h1.forEach((h, i) => { const c = ws1.getRow(2).getCell(i + 1); c.value = h; headStyle(c) })
  ws1.getRow(2).height = 30
  ;[12, 30, 9, 9, 9, 13, 13, 16, 14].forEach((w, i) => { ws1.getColumn(i + 1).width = w })

  projects.forEach((p, idx) => {
    const r = ws1.getRow(3 + idx)
    r.getCell(1).value = p.projectCode
    r.getCell(2).value = p.projectName
    r.getCell(3).value = p.workers
    r.getCell(4).value = Math.round(p.totalHours * 100) / 100
    r.getCell(5).value = Math.round(p.totalOtHours * 100) / 100
    r.getCell(6).value = Math.round(p.laborCost * 100) / 100
    r.getCell(7).value = Math.round(p.otCost * 100) / 100
    r.getCell(8).value = Math.round(p.allowance * 100) / 100
    r.getCell(9).value = Math.round(p.total * 100) / 100
    ;[6, 7, 8, 9].forEach(c => { r.getCell(c).numFmt = '#,##0.00' })
    r.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= 9) borderAll(cell) })
  })

  // แถวรวม
  const totalRow = ws1.getRow(3 + projects.length)
  totalRow.getCell(2).value = 'รวมทั้งสิ้น'
  ;[6, 7, 8, 9].forEach(col => {
    const colL = String.fromCharCode(64 + col)
    totalRow.getCell(col).value = { formula: `SUM(${colL}3:${colL}${2 + projects.length})` }
    totalRow.getCell(col).numFmt = '#,##0.00'
  })
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col <= 9) { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }; borderAll(cell) }
  })

  // ===== Sheet 2: รายละเอียดต่อคนต่องาน =====
  const ws2 = wb.addWorksheet('รายละเอียด')
  const h2 = ['เลข Job', 'ชื่องาน', 'รหัส', 'ชื่อพนักงาน', 'วันที่', 'ชม.', 'OT', 'ค่าแรง', 'ค่า OT', 'เบี้ย/น้ำ/อื่นๆ', 'รวม']
  h2.forEach((h, i) => { const c = ws2.getRow(1).getCell(i + 1); c.value = h; headStyle(c) })
  ;[12, 24, 7, 20, 12, 7, 7, 12, 12, 13, 13].forEach((w, i) => { ws2.getColumn(i + 1).width = w })

  const sorted = [...logs].sort((a, b) => (a.project_id || 'zzz').localeCompare(b.project_id || 'zzz') || a.log_date.localeCompare(b.log_date))
  let r2 = 2
  for (const log of sorted) {
    const emp = empMap.get(log.employee_id)
    const c = entryCost(log, emp)
    const row = ws2.getRow(r2)
    row.getCell(1).value = log.project?.project_code || '-'
    row.getCell(2).value = log.project?.project_name || 'ไม่ระบุงาน'
    row.getCell(3).value = emp?.employee_code || ''
    row.getCell(4).value = emp?.name || ''
    row.getCell(5).value = log.log_date
    row.getCell(6).value = log.hours_spent || 0
    row.getCell(7).value = log.ot_hours || 0
    row.getCell(8).value = Math.round(c.labor * 100) / 100
    row.getCell(9).value = Math.round(c.ot * 100) / 100
    row.getCell(10).value = Math.round(c.allowance * 100) / 100
    row.getCell(11).value = Math.round(c.total * 100) / 100
    ;[8, 9, 10, 11].forEach(col => { row.getCell(col).numFmt = '#,##0.00' })
    row.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= 11) borderAll(cell) })
    r2++
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="project_cost_${month}.xlsx"`,
    },
  })
}
