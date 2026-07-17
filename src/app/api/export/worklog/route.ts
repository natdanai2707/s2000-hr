import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { auth } from '@/auth'
import { monthRange, eachDateInclusive } from '@/lib/date'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const HEADER_BG = '1F4E79'
const SUB_BG = 'BDD7EE'

function thaiWeekday(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00+07:00').toLocaleDateString('th-TH', {
    weekday: 'long',
    timeZone: 'Asia/Bangkok',
  })
}

export async function GET(request: NextRequest) {
  // เฉพาะ HR/Admin
  const session = await auth()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const employeeId = searchParams.get('employeeId') // uuid หรือ 'all'
  if (!month) {
    return NextResponse.json({ error: 'month is required' }, { status: 400 })
  }
  const { start, end } = monthRange(month)

  // พนักงานที่จะออกใบ
  let empQuery = supabase.from('employees').select('*').eq('is_active', true).order('employee_code')
  if (employeeId && employeeId !== 'all') empQuery = empQuery.eq('id', employeeId)
  const { data: employees } = await empQuery
  if (!employees || employees.length === 0) {
    return NextResponse.json({ error: 'No employees found' }, { status: 404 })
  }

  const empIds = employees.map(e => e.id)

  // work logs + approved leaves ของทุกคนในเดือน (batch)
  const [logsRes, leavesRes] = await Promise.all([
    supabase
      .from('work_logs')
      .select('*, project:projects(project_code, project_name)')
      .in('employee_id', empIds)
      .gte('log_date', start)
      .lte('log_date', end),
    supabase
      .from('leave_requests')
      .select('*, leave_type:leave_types(name, code)')
      .in('employee_id', empIds)
      .eq('status', 'approved')
      .gte('start_date', start)
      .lte('end_date', end),
  ])
  const allLogs = logsRes.data || []
  const allLeaves = leavesRes.data || []

  const thaiMonth = new Date(start + 'T12:00:00+07:00').toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'S-2000 HR'

  const headers = [
    'ลำดับ', 'วันที่', 'วัน', 'เลข Job', 'ชื่องาน', 'รายละเอียดการทำงาน',
    'สถานที่ทำงาน', 'เวลาทำงาน (ชม.)', 'OT (ชม.)', 'ค่าน้ำ', 'เบี้ยเลี้ยง',
    'เงินได้อื่นๆ', 'สาย/ลา/ขาด',
  ]
  const colWidths = [6, 12, 10, 10, 22, 34, 20, 12, 9, 9, 10, 11, 18]

  for (const emp of employees) {
    // ชื่อชีตต้อง <=31 ตัว ไม่ซ้ำ
    const safeName = `${emp.employee_code || ''} ${emp.name || ''}`.trim().slice(0, 28).replace(/[\\/?*[\]:]/g, ' ') || emp.id.slice(0, 8)
    const ws = wb.addWorksheet(safeName || 'emp', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    })

    const empLogs = allLogs.filter(l => l.employee_id === emp.id)
    const empLeaves = allLeaves.filter(l => l.employee_id === emp.id)

    // สร้าง map วันที่ -> ข้อความ สาย/ลา/ขาด
    const dayLeave: Record<string, string> = {}
    for (const lv of empLeaves) {
      const code = (lv as any).leave_type?.code
      const name = (lv as any).leave_type?.name || 'ลา'
      let label = name
      if (code === 'LATE') label = `สาย ${lv.late_minutes || 0} นาที`
      else if (code === 'ABSENT') label = 'ขาดงาน'
      for (const d of eachDateInclusive(lv.start_date, lv.end_date)) {
        dayLeave[d] = dayLeave[d] ? `${dayLeave[d]}, ${label}` : label
      }
    }

    // Title
    ws.mergeCells('A1:M1')
    const t = ws.getCell('A1')
    t.value = `ใบปฏิบัติงาน — ${emp.name} (${emp.employee_code || '-'})   |   ${thaiMonth}   |   บริษัท เอส-2000 สตีล แฟบริเคท จำกัด`
    t.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    t.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 26

    // Header
    const hr = ws.getRow(2)
    headers.forEach((h, i) => {
      const c = hr.getCell(i + 1)
      c.value = h
      c.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })
    ws.getRow(2).height = 30
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    // สร้างแถวข้อมูล: รวมทุกวันที่มี work log หรือ มีลา
    const logsByDate: Record<string, any[]> = {}
    for (const lg of empLogs) {
      if (!logsByDate[lg.log_date]) logsByDate[lg.log_date] = []
      logsByDate[lg.log_date].push(lg)
    }
    const allDates = [...new Set([...Object.keys(logsByDate), ...Object.keys(dayLeave)])].sort()

    let r = 3
    let seq = 1
    for (const date of allDates) {
      const dayLogs = logsByDate[date] || []
      const leaveText = dayLeave[date] || ''
      if (dayLogs.length === 0) {
        // วันที่มีแต่การลา/ขาด/สาย ไม่มี work log
        const row = ws.getRow(r)
        row.getCell(1).value = seq++
        row.getCell(2).value = date
        row.getCell(3).value = thaiWeekday(date)
        row.getCell(13).value = leaveText
        r++
      } else {
        dayLogs.forEach((lg, idx) => {
          const row = ws.getRow(r)
          row.getCell(1).value = idx === 0 ? seq : ''
          row.getCell(2).value = idx === 0 ? date : ''
          row.getCell(3).value = idx === 0 ? thaiWeekday(date) : ''
          row.getCell(4).value = lg.job_code || (lg as any).project?.project_code || ''
          row.getCell(5).value = (lg as any).project?.project_name || ''
          row.getCell(6).value = lg.task_description || ''
          row.getCell(7).value = lg.site_location || ''
          row.getCell(8).value = lg.hours_spent || 0
          row.getCell(9).value = lg.ot_hours || 0
          row.getCell(10).value = lg.water_allowance || 0
          row.getCell(11).value = lg.daily_allowance || 0
          row.getCell(12).value = lg.other_income || 0
          row.getCell(13).value = idx === 0 ? leaveText : ''
          r++
        })
        seq++
      }
    }

    const lastDataRow = r - 1
    // เส้นขอบ + จัดกลาง
    for (let rr = 3; rr <= lastDataRow; rr++) {
      const row = ws.getRow(rr)
      for (let cc = 1; cc <= 13; cc++) {
        const cell = row.getCell(cc)
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
        cell.font = { name: 'Arial', size: 9 }
        if ([1, 2, 3, 4, 8, 9, 10, 11, 12].includes(cc)) cell.alignment = { horizontal: 'center', vertical: 'middle' }
        else cell.alignment = { vertical: 'middle', wrapText: true }
      }
      row.height = 18
    }

    // แถวรวม
    if (lastDataRow >= 3) {
      const totalRow = ws.getRow(lastDataRow + 1)
      ws.mergeCells(`A${lastDataRow + 1}:G${lastDataRow + 1}`)
      const tl = ws.getCell(`A${lastDataRow + 1}`)
      tl.value = 'รวม'
      tl.font = { name: 'Arial', bold: true, size: 10 }
      tl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
      tl.alignment = { horizontal: 'center', vertical: 'middle' }
      ;[8, 9, 10, 11, 12].forEach(col => {
        const letter = String.fromCharCode(64 + col)
        const cell = totalRow.getCell(col)
        cell.value = { formula: `SUM(${letter}3:${letter}${lastDataRow})` }
        cell.numFmt = '#,##0.##'
        cell.font = { name: 'Arial', bold: true, size: 10 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUB_BG}` } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      totalRow.getCell(1).border = { top: { style: 'thin' }, bottom: { style: 'thin' } }
      for (let cc = 1; cc <= 13; cc++) {
        totalRow.getCell(cc).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
      }
    }

    // ช่องเซ็นหัวหน้า
    const signRow = lastDataRow + 3
    ws.getCell(`E${signRow}`).value = 'ผู้ปฏิบัติงาน .............................'
    ws.getCell(`E${signRow}`).font = { name: 'Arial', size: 9 }
    ws.getCell(`J${signRow}`).value = 'หัวหน้างานรับรอง .............................'
    ws.getCell(`J${signRow}`).font = { name: 'Arial', size: 9 }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const who = employeeId && employeeId !== 'all' ? employees[0].employee_code || 'emp' : 'all'
  const filename = `worklog_${who}_${month}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
