import ExcelJS from 'exceljs'

export interface SheetPreview {
  name: string
  header_row: number // 1-based
  headers: unknown[]
  rows: unknown[][] // ทั้งหมด (ไม่รวม header)
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
    else out.push(v ?? null)
  }
  return out
}

// หาแถวหัวตาราง: แถวแรกที่มีข้อความอย่างน้อย 3 ช่องและมีคำว่า รายการ/ปริมาณ/หน่วย
function findHeaderRow(ws: ExcelJS.Worksheet, colCount: number): number {
  const maxScan = Math.min(ws.rowCount, 30)
  for (let r = 1; r <= maxScan; r++) {
    const vals = rowValues(ws.getRow(r), colCount)
    const texts = vals.map(v => (v === null ? '' : String(v))).filter(Boolean)
    const joined = texts.join('|')
    if (texts.length >= 3 && /(รายการ|ปริมาณ|หน่วย|description|qty|unit)/i.test(joined)) return r
  }
  return 1
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetPreview[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const sheets: SheetPreview[] = []
  wb.eachSheet(ws => {
    const colCount = Math.max(ws.actualColumnCount || ws.columnCount || 0, 1)
    const headerRow = findHeaderRow(ws, colCount)
    const headers = rowValues(ws.getRow(headerRow), colCount)
    const rows: unknown[][] = []
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const vals = rowValues(ws.getRow(r), colCount)
      if (vals.every(v => v === null || v === '')) continue
      rows.push(vals)
    }
    if (rows.length === 0) return
    sheets.push({ name: ws.name, header_row: headerRow, headers, rows, preview: rows.slice(0, 20) })
  })
  return sheets
}
