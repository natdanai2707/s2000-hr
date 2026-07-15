import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { auth } from '@/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  // เฉพาะ HR/Admin เท่านั้นที่ออกรายงานเงินเดือนได้
  const session = await auth()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // format: 2026-05
  const type = searchParams.get('type') || 'daily' // daily | monthly

  if (!month) {
    return NextResponse.json({ error: 'month is required' }, { status: 400 })
  }

  const startDate = `${month}-01`
  const endDate = new Date(
    parseInt(month.slice(0, 4)),
    parseInt(month.slice(5, 7)),
    0
  ).toISOString().split('T')[0]

  // ดึง employees
  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('is_active', true)
    .eq('employee_type', type === 'daily' ? 'daily' : 'monthly')
    .order('employee_code')

  if (!employees || employees.length === 0) {
    return NextResponse.json({ error: 'No employees found' }, { status: 404 })
  }

  // ดึง work logs
  const { data: workLogs } = await supabase
    .from('work_logs')
    .select('*, project:projects(project_code, project_name)')
    .gte('log_date', startDate)
    .lte('log_date', endDate)

  // ดึง leave requests ที่ approved
  const { data: leaveRequests } = await supabase
    .from('leave_requests')
    .select('*, leave_type:leave_types(name, code, is_paid)')
    .eq('status', 'approved')
    .gte('start_date', startDate)
    .lte('end_date', endDate)

  // สรุปข้อมูลต่อพนักงาน
  const empSummary = employees.map(emp => {
    const logs = (workLogs || []).filter(l => l.employee_id === emp.id)
    const leaves = (leaveRequests || []).filter(l => l.employee_id === emp.id)

    const totalOtHours = logs.reduce((s, l) => s + (l.ot_hours || 0), 0)
    const totalAllowance = logs.reduce((s, l) => s + (l.daily_allowance || 0), 0)
    const totalWater = logs.reduce((s, l) => s + (l.water_allowance || 0), 0)
    const lateMinutes = leaves
      .filter(l => (l as any).leave_type?.code === 'LATE')
      .reduce((s, l) => s + (l.late_minutes || 0), 0)
    const absentDays = leaves
      .filter(l => (l as any).leave_type?.code === 'ABSENT')
      .reduce((s, l) => s + l.total_days, 0)
    const unpaidLeaveDays = leaves
      .filter(l => !(l as any).leave_type?.is_paid)
      .filter(l => (l as any).leave_type?.code !== 'ABSENT')
      .reduce((s, l) => s + l.total_days, 0)

    // คำนวณวันทำงานจริง (unique dates ที่มี work log)
    const workDates = new Set(logs.map(l => l.log_date))
    const workDays = workDates.size

    const dailyRate = emp.daily_rate || 0
    const monthlySalary = emp.monthly_salary || 0

    // คำนวณค่าแรงพื้นฐาน
    const basePay = type === 'daily'
      ? dailyRate * workDays
      : monthlySalary

    // คำนวณ OT = (ค่าแรง/วัน ÷ 8) × 1.5 × ชม.OT
    const hourlyRate = type === 'daily' ? dailyRate / 8 : monthlySalary / 30 / 8
    const otPay = hourlyRate * 1.5 * totalOtHours

    // คำนวณหักมาสาย = (ค่าแรง/ชม.) × นาทีสาย/60
    const lateDeduct = hourlyRate * (lateMinutes / 60)

    // คำนวณหักขาด/ลาไม่รับค่าจ้าง
    const absentDeduct = type === 'daily'
      ? dailyRate * (absentDays + unpaidLeaveDays)
      : (monthlySalary / 30) * (absentDays + unpaidLeaveDays)

    const grossPay = basePay + otPay + totalAllowance + totalWater
    const sso = Math.min(grossPay * 0.03, 750)
    const netPay = grossPay - sso - lateDeduct - absentDeduct

    return {
      emp,
      workDays,
      dailyRate,
      monthlySalary,
      basePay,
      totalOtHours,
      otMultiplier: 1.5,
      otHoursMultiplied: totalOtHours * 1.5,
      otPay,
      totalAllowance,
      totalWater,
      grossPay,
      sso,
      lateDeduct,
      absentDeduct,
      netPay,
      lateMinutes,
      absentDays,
      logs,
    }
  })

  // สร้าง Excel
  const wb = new ExcelJS.Workbook()
  wb.creator = 'S-2000 Leave System'

  const HEADER_BG = '1F4E79'
  const SUB_BG = 'BDD7EE'
  const INPUT_BG = 'FFF2CC'
  const GREEN_BG = 'E2EFDA'
  const GRAY_BG = 'F2F2F2'

  const thaiMonth = new Date(startDate).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
  const periodLabel = type === 'daily' ? `ค่าแรงรายวัน ${thaiMonth}` : `เงินเดือน ${thaiMonth}`

  // ============================
  // SHEET 1: ตารางจ่าย
  // ============================
  const ws1 = wb.addWorksheet('ตารางจ่าย')

  const headers = [
    'ลำดับ', 'รหัส', 'ชื่อ-สกุล', 'ตำแหน่ง',
    type === 'daily' ? 'ค่าแรง/วัน' : 'เงินเดือน',
    type === 'daily' ? 'วันทำงาน' : '',
    'ค่าแรงพื้นฐาน',
    'OT (ชม.)', 'ตัวคูณ OT', 'OT ชม.(คูณแล้ว)', 'ค่า OT',
    'เบี้ยเลี้ยง', 'ค่าน้ำ',
    'รวมเงินได้', 'ปกส.3%', 'หักมาสาย/ขาด', 'หักอื่นๆ', 'เงินสุทธิ'
  ]

  // Title row
  ws1.mergeCells('A1:R1')
  const titleCell = ws1.getCell('A1')
  titleCell.value = `ตาราง${periodLabel}  |  บริษัท เอส-2000 สตีล แฟบริเคท จำกัด`
  titleCell.font = { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws1.getRow(1).height = 28

  // Note row
  ws1.mergeCells('A2:R2')
  const noteCell = ws1.getCell('A2')
  noteCell.value = '* สีเหลือง = HR แก้ไขได้  |  OT default = 1.5x (วันปกติ), 3.0x (วันหยุด)  |  ปกส. = 3% สูงสุด 750 บาท  (พ.ร.บ.คุ้มครองแรงงาน มาตรา 61)'
  noteCell.font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF595959' } }
  noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${INPUT_BG}` } }
  ws1.getRow(2).height = 16

  // Header row
  const headerRow = ws1.getRow(3)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  ws1.getRow(3).height = 40

  // Column widths
  const colWidths = [5, 7, 22, 20, 11, 9, 12, 8, 10, 13, 12, 10, 10, 12, 10, 13, 10, 12]
  colWidths.forEach((w, i) => { ws1.getColumn(i + 1).width = w })

  const DATA_START = 4
  empSummary.forEach((s, idx) => {
    const r = DATA_START + idx
    const row = ws1.getRow(r)

    const setYellow = (cell: any, val: any) => {
      cell.value = val
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${INPUT_BG}` } }
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0000FF' } }
      cell.numFmt = '#,##0.00'
    }

    row.getCell(1).value = idx + 1
    row.getCell(2).value = s.emp.employee_code
    row.getCell(3).value = s.emp.name
    row.getCell(4).value = s.emp.position

    setYellow(row.getCell(5), type === 'daily' ? s.dailyRate : s.monthlySalary)
    if (type === 'daily') setYellow(row.getCell(6), s.workDays)
    else row.getCell(6).value = ''

    // ค่าแรงพื้นฐาน formula
    const c5 = String.fromCharCode(64 + 5)
    const c6 = String.fromCharCode(64 + 6)
    const basCell = row.getCell(7)
    basCell.value = type === 'daily' ? { formula: `${c5}${r}*${c6}${r}` } : { formula: `${c5}${r}` }
    basCell.numFmt = '#,##0.00'

    setYellow(row.getCell(8), s.totalOtHours)
    setYellow(row.getCell(9), s.otMultiplier)
    row.getCell(10).value = { formula: `H${r}*I${r}` }
    row.getCell(10).numFmt = '#,##0.00'
    row.getCell(11).value = { formula: type === 'daily' ? `(E${r}/8)*J${r}` : `(E${r}/30/8)*J${r}` }
    row.getCell(11).numFmt = '#,##0.00'

    setYellow(row.getCell(12), s.totalAllowance)
    setYellow(row.getCell(13), s.totalWater)

    row.getCell(14).value = { formula: `G${r}+K${r}+L${r}+M${r}` }
    row.getCell(14).numFmt = '#,##0.00'
    row.getCell(15).value = { formula: `MIN(N${r}*0.03,750)` }
    row.getCell(15).numFmt = '#,##0.00'
    setYellow(row.getCell(16), Math.round((s.lateDeduct + s.absentDeduct) * 100) / 100)
    setYellow(row.getCell(17), 0)

    const netCell = row.getCell(18)
    netCell.value = { formula: `N${r}-O${r}-P${r}-Q${r}` }
    netCell.numFmt = '#,##0.00'
    netCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN_BG}` } }
    netCell.font = { name: 'Arial', bold: true, size: 10 }

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum <= 18) {
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
        if (!cell.alignment) cell.alignment = { vertical: 'middle' }
      }
    })
    row.height = 18
  })

  // Total row
  const totalRow = DATA_START + empSummary.length
  ws1.mergeCells(`A${totalRow}:E${totalRow}`)
  const totalLabel = ws1.getCell(`A${totalRow}`)
  totalLabel.value = 'รวมทั้งสิ้น'
  totalLabel.font = { name: 'Arial', bold: true, size: 10 }
  totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
  totalLabel.alignment = { horizontal: 'center' }

  ;[7, 11, 12, 13, 14, 15, 16, 17, 18].forEach(col => {
    const colLetter = String.fromCharCode(64 + col)
    const cell = ws1.getCell(`${colLetter}${totalRow}`)
    cell.value = { formula: `SUM(${colLetter}${DATA_START}:${colLetter}${totalRow - 1})` }
    cell.numFmt = '#,##0.00'
    cell.font = { name: 'Arial', bold: true, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })

  // ============================
  // SHEET 2: สรุปรายบุคคล
  // ============================
  const ws2 = wb.addWorksheet('สรุปรายบุคคล')

  ws2.mergeCells('A1:J1')
  const t2 = ws2.getCell('A1')
  t2.value = `สรุป${periodLabel}  |  บริษัท เอส-2000 สตีล แฟบริเคท จำกัด`
  t2.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
  t2.alignment = { horizontal: 'center', vertical: 'middle' }
  ws2.getRow(1).height = 24

  const h2 = ['รหัส', 'ชื่อ-สกุล', 'ค่าแรงพื้นฐาน', 'ค่า OT', 'เบี้ยเลี้ยง', 'ค่าน้ำ', 'รวมเงินได้', 'ปกส.', 'หักต่างๆ', 'เงินสุทธิ']
  h2.forEach((h, i) => {
    const cell = ws2.getRow(2).getCell(i + 1)
    cell.value = h
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  ws2.getRow(2).height = 24
  ;[7, 22, 14, 12, 12, 10, 12, 10, 12, 13].forEach((w, i) => { ws2.getColumn(i + 1).width = w })

  empSummary.forEach((s, idx) => {
    const r = 3 + idx
    const srcRow = DATA_START + idx
    const row = ws2.getRow(r)
    row.getCell(1).value = s.emp.employee_code
    row.getCell(2).value = s.emp.name
    ;[7, 11, 12, 13, 14, 15, 16, 18].forEach((col, ci) => {
      const colLetter = String.fromCharCode(64 + col)
      const cell = row.getCell(ci + 3)
      cell.value = { formula: `ตารางจ่าย!${colLetter}${srcRow}` }
      cell.numFmt = '#,##0.00'
      if (ci + 3 === 10) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN_BG}` } }
        cell.font = { name: 'Arial', bold: true }
      }
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })
    row.height = 18
  })

  // Total
  const t2Total = 3 + empSummary.length
  ws2.mergeCells(`A${t2Total}:B${t2Total}`)
  const t2Label = ws2.getCell(`A${t2Total}`)
  t2Label.value = 'รวมทั้งสิ้น'
  t2Label.font = { bold: true }
  t2Label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
  t2Label.alignment = { horizontal: 'center' }
  for (let col = 3; col <= 10; col++) {
    const colLetter = String.fromCharCode(64 + col)
    const cell = ws2.getCell(`${colLetter}${t2Total}`)
    cell.value = { formula: `SUM(${colLetter}3:${colLetter}${t2Total - 1})` }
    cell.numFmt = '#,##0.00'
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }

  // ============================
  // SHEET 3: บันทึกงาน (Work Log Detail)
  // ============================
  const ws3 = wb.addWorksheet('บันทึกงาน')
  ws3.mergeCells('A1:H1')
  const t3 = ws3.getCell('A1')
  t3.value = `บันทึกการปฏิบัติงาน ${thaiMonth}`
  t3.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
  t3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
  t3.alignment = { horizontal: 'center', vertical: 'middle' }

  const h3 = ['รหัส', 'ชื่อ', 'วันที่', 'โปรเจกต์', 'รายละเอียดงาน', 'OT (ชม.)', 'เบี้ยเลี้ยง', 'ค่าน้ำ']
  h3.forEach((h, i) => {
    const cell = ws3.getRow(2).getCell(i + 1)
    cell.value = h
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  ;[7, 18, 12, 18, 30, 10, 10, 10].forEach((w, i) => { ws3.getColumn(i + 1).width = w })

  let logRow = 3
  empSummary.forEach(s => {
    s.logs.forEach(log => {
      const row = ws3.getRow(logRow)
      row.getCell(1).value = s.emp.employee_code
      row.getCell(2).value = s.emp.name
      row.getCell(3).value = log.log_date
      row.getCell(4).value = (log as any).project ? `${(log as any).project.project_code}` : ''
      row.getCell(5).value = log.task_description
      row.getCell(6).value = log.ot_hours || 0
      row.getCell(7).value = log.daily_allowance || 0
      row.getCell(8).value = log.water_allowance || 0
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= 8) {
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
        }
      })
      row.height = 16
      logRow++
    })
  })

  // ============================
  // SHEET 4: Validation Check
  // ============================
  const ws4 = wb.addWorksheet('Validation Check')
  ws4.mergeCells('A1:E1')
  const t4 = ws4.getCell('A1')
  t4.value = `แผ่นตรวจสอบความถูกต้อง — ${periodLabel}`
  t4.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
  t4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
  t4.alignment = { horizontal: 'center', vertical: 'middle' }
  ws4.getRow(1).height = 24
  ;[35, 20, 20, 5, 25].forEach((w, i) => { ws4.getColumn(i + 1).width = w })

  const addSection = (row: number, title: string) => {
    ws4.mergeCells(`A${row}:E${row}`)
    const c = ws4.getCell(`A${row}`)
    c.value = title
    c.font = { name: 'Arial', bold: true, size: 10, color: { argb: `FF1F4E79` } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
    c.alignment = { horizontal: 'left', vertical: 'middle' }
    ws4.getRow(row).height = 18
  }

  const addCheck = (row: number, label: string, formula: string, checkFormula?: string) => {
    ws4.getCell(`A${row}`).value = label
    ws4.getCell(`B${row}`).value = { formula }
    ws4.getCell(`B${row}`).numFmt = '#,##0.00'
    if (checkFormula) {
      ws4.getCell(`E${row}`).value = { formula: checkFormula }
      ws4.getCell(`E${row}`).font = { bold: true, size: 11 }
    }
  }

  const n = empSummary.length
  const lastWs1 = DATA_START + n

  addSection(2, '1. ตรวจสอบยอดรวมเงินสุทธิ')
  addCheck(3, 'ตารางจ่าย (แถวรวม)', `ตารางจ่าย!R${lastWs1}`)
  addCheck(4, 'สรุปรายบุคคล (แถวรวม)', `สรุปรายบุคคล!J${3 + n}`)
  addCheck(5, 'ผลต่าง', 'B3-B4', '=IF(ABS(B5)<0.01,"✅ ยอดตรงกัน","❌ ยอดไม่ตรง")')

  addSection(7, '2. ตรวจสอบยอดรวม OT')
  addCheck(8, 'OT รวม (ตารางจ่าย)', `ตารางจ่าย!K${lastWs1}`)
  addCheck(9, 'OT รวม (สรุปรายบุคคล)', `สรุปรายบุคคล!D${3 + n}`)
  addCheck(10, 'ผลต่าง', 'B8-B9', '=IF(ABS(B10)<0.01,"✅ ยอดตรงกัน","❌ ยอดไม่ตรง")')

  addSection(12, '3. ตรวจสอบยอด ปกส.')
  addCheck(13, 'ปกส. รวม (ตารางจ่าย)', `ตารางจ่าย!O${lastWs1}`)
  addCheck(14, 'ปกส. รวม (สรุปรายบุคคล)', `สรุปรายบุคคล!H${3 + n}`)
  addCheck(15, 'ผลต่าง', 'B13-B14', '=IF(ABS(B15)<0.01,"✅ ยอดตรงกัน","❌ ยอดไม่ตรง")')

  addSection(17, '4. ตรวจสอบจำนวนพนักงาน')
  addCheck(18, 'จำนวนในตารางจ่าย', `COUNTA(ตารางจ่าย!B${DATA_START}:B${lastWs1 - 1})`)
  addCheck(19, 'จำนวนในสรุปรายบุคคล', `COUNTA(สรุปรายบุคคล!B3:B${2 + n})`)
  addCheck(20, 'ผลต่าง', 'B18-B19', '=IF(B20=0,"✅ จำนวนตรงกัน","❌ จำนวนไม่ตรง")')

  addSection(22, '5. ตรวจสอบ OT กฎหมาย (ไม่เกิน 36 ชม./สัปดาห์)')
  ws4.getCell('A23').value = 'ชื่อพนักงาน'
  ws4.getCell('B23').value = 'OT รวมเดือน (ชม.)'
  ws4.getCell('C23').value = 'OT เฉลี่ย/สัปดาห์'
  ws4.getCell('E23').value = 'สถานะ'
  ;['A23', 'B23', 'C23', 'E23'].forEach(addr => {
    ws4.getCell(addr).font = { bold: true }
    ws4.getCell(addr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GRAY_BG}` } }
  })

  empSummary.forEach((s, idx) => {
    const r = 24 + idx
    ws4.getCell(`A${r}`).value = s.emp.name
    ws4.getCell(`B${r}`).value = s.totalOtHours
    ws4.getCell(`C${r}`).value = { formula: `B${r}/4` }
    ws4.getCell(`C${r}`).numFmt = '#,##0.00'
    ws4.getCell(`E${r}`).value = { formula: `IF(C${r}<=36,"✅ ปกติ","⚠️ เกิน 36 ชม.")` }
    ws4.getCell(`E${r}`).font = { bold: true }
  })

  // Export
  const buffer = await wb.xlsx.writeBuffer()

  const filename = `payroll_${type}_${month}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}