import ExcelJS from 'exceljs'
import { headerScore, isTwoRowHeader, combineHeaderRows } from './split'

export interface SheetPreview {
  name: string
  header_row: number // 1-based แถวหัวตารางแถวแรก
  header_rows: number // 1 หรือ 2 (รูปแบบ S-2000 ใช้ 2 แถว: กลุ่ม + หัวย่อย)
  headers: unknown[]
  rows: unknown[][] // ข้อมูลทั้งหมดหลังหัวตาราง
  preview: unknown[][] // 20 แถวแรก
}

function rowValues(row: ExcelJS.Row, colCount: number): unknown[] {
  const out: unknown[] = []
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c)
    const v = cell.value
    if (v && typeof v === 'object' && 'result' in v) out.push((v as ExcelJS.CellFormulaValue).result ?? null)
    else if (v && typeof v === 'object' && 'richText' in v)
      out.push((v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join(''))
    else if (v && typeof v === 'object' && 'error' in v) out.push(null)
    else out.push(v ?? null)
  }
  return out
}

// หาแถวหัวตารางด้วยการให้คะแนน แถวที่มีชื่อคอลัมน์ที่รู้จักมากที่สุดคือหัวตาราง
// วิธีนี้ทนต่อหัวกระดาษที่มีคำว่า PROJECT / BILL OF QUANTITIES อยู่ด้านบน
function findHeaderRow(ws: ExcelJS.Worksheet, colCount: number): number {
  const maxScan = Math.min(ws.rowCount, 40)
  let best = 0
  let bestScore = 0
  for (let r = 1; r <= maxScan; r++) {
    const score = headerScore(rowValues(ws.getRow(r), colCount))
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  return bestScore >= 3 ? best : 1
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetPreview[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const sheets: SheetPreview[] = []
  wb.eachSheet(ws => {
    const colCount = Math.max(ws.actualColumnCount || ws.columnCount || 0, 1)
    const headerRow = findHeaderRow(ws, colCount)
    const first = rowValues(ws.getRow(headerRow), colCount)
    const second = headerRow < ws.rowCount ? rowValues(ws.getRow(headerRow + 1), colCount) : []

    // รูปแบบ S-2000 ใช้หัวตาราง 2 แถว แถวบนเป็นกลุ่ม (MATERIAL, LABOUR)
    // แถวล่างเป็นหัวย่อย (@, SUB TOTAL) ต้องรวมกันจึงจะแยกราคาต่อหน่วยออกจากยอดรวมได้
    const twoRow = isTwoRowHeader(first, second)
    const headers = twoRow ? combineHeaderRows(first, second) : first
    const dataStart = headerRow + (twoRow ? 2 : 1)

    const rows: unknown[][] = []
    for (let r = dataStart; r <= ws.rowCount; r++) {
      const vals = rowValues(ws.getRow(r), colCount)
      if (vals.every(v => v === null || v === '')) continue
      rows.push(vals)
    }
    if (rows.length === 0) return
    sheets.push({
      name: ws.name,
      header_row: headerRow,
      header_rows: twoRow ? 2 : 1,
      headers,
      rows,
      preview: rows.slice(0, 20),
    })
  })
  return sheets
}
