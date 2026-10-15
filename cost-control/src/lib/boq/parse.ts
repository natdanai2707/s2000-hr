import ExcelJS from 'exceljs'
import { headerScore, isTwoRowHeader, combineHeaderRows } from './split'
import type { SheetLayout } from './layout'

export interface RawSheet {
  name: string
  grid: unknown[][] // grid[0] คือแถวที่ 1 ของชีต
}

export interface SheetPreview {
  name: string
  header_row: number // 1-based แถวหัวตารางแถวแรก
  header_rows: number // 1 หรือ 2 (รูปแบบ S-2000 ใช้ 2 แถว: กลุ่ม + หัวย่อย)
  data_start_row: number // 1-based แถวแรกของข้อมูลจริง
  headers: unknown[]
  rows: unknown[][] // ข้อมูลทั้งหมดตั้งแต่ data_start_row
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

// อ่านทุกชีตเป็นตารางดิบ ไม่ตัดอะไรทิ้ง เพื่อให้ตัววิเคราะห์เห็นหัวกระดาษและบล็อกสรุปด้วย
export async function readSheets(buffer: ArrayBuffer | Buffer): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const sheets: RawSheet[] = []
  wb.eachSheet(ws => {
    const colCount = Math.max(ws.actualColumnCount || ws.columnCount || 0, 1)
    const grid: unknown[][] = []
    for (let r = 1; r <= ws.rowCount; r++) grid.push(rowValues(ws.getRow(r), colCount))
    sheets.push({ name: ws.name, grid })
  })
  return sheets
}

// ทางสำรองแบบกฎตายตัว ใช้เมื่อยังไม่ได้ตั้งค่า API key หรือเรียกตัววิเคราะห์ไม่สำเร็จ
// ให้คะแนนแต่ละแถวว่าหน้าตาเหมือนหัวตารางแค่ไหน แล้วเลือกแถวที่คะแนนสูงสุด
export function detectLayout(grid: unknown[][]): SheetLayout {
  const maxScan = Math.min(grid.length, 40)
  let best = 0
  let bestScore = 0
  for (let r = 0; r < maxScan; r++) {
    const score = headerScore(grid[r] ?? [])
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  const headerIdx = bestScore >= 3 ? best : 0
  const twoRow = isTwoRowHeader(grid[headerIdx] ?? [], grid[headerIdx + 1] ?? [])
  const headerRows: 1 | 2 = twoRow ? 2 : 1
  return {
    header_row: headerIdx + 1,
    header_rows: headerRows,
    data_start_row: headerIdx + 1 + headerRows,
  }
}

export function buildPreview(name: string, grid: unknown[][], layout: SheetLayout): SheetPreview {
  const headerIdx = layout.header_row - 1
  const first = grid[headerIdx] ?? []
  const second = grid[headerIdx + 1] ?? []
  const headers = layout.header_rows === 2 ? combineHeaderRows(first, second) : first

  const rows: unknown[][] = []
  for (let r = layout.data_start_row - 1; r < grid.length; r++) {
    const vals = grid[r] ?? []
    if (vals.every(v => v === null || v === '')) continue
    rows.push(vals)
  }
  return {
    name,
    header_row: layout.header_row,
    header_rows: layout.header_rows,
    data_start_row: layout.data_start_row,
    headers,
    rows,
    preview: rows.slice(0, 20),
  }
}

// รูปแบบเดิม: อ่านไฟล์แล้วเดาโครงด้วยกฎตายตัว ใช้ในเทสต์และเป็นทางสำรอง
export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetPreview[]> {
  const sheets = await readSheets(buffer)
  return sheets
    .map(s => buildPreview(s.name, s.grid, detectLayout(s.grid)))
    .filter(s => s.rows.length > 0)
}
