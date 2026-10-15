// โครงของชีต: หัวตารางอยู่แถวไหน กี่แถว และข้อมูลจริงเริ่มแถวไหน (ทุกค่าเป็นเลขแถวแบบ 1-based)
// แยกจาก mapping คอลัมน์ เพราะ template ที่บันทึกไว้ต้องจำทั้งสองอย่าง
export interface SheetLayout {
  header_row: number
  header_rows: 1 | 2
  data_start_row: number
}

export interface StoredTemplate {
  columns: Record<string, number | null | undefined>
  layout?: SheetLayout
}

// template รุ่นแรกเก็บเฉพาะ mapping คอลัมน์ ต้องอ่านของเดิมได้ด้วย
export function readStoredTemplate(value: unknown): StoredTemplate | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if ('columns' in obj && obj.columns && typeof obj.columns === 'object') {
    return {
      columns: obj.columns as StoredTemplate['columns'],
      layout: (obj.layout as SheetLayout | undefined) ?? undefined,
    }
  }
  return { columns: obj as StoredTemplate['columns'] }
}
