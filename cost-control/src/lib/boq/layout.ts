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
  // ชื่อหัวคอลัมน์ (normalize แล้ว) ของแต่ละคอลัมน์ที่จับคู่ไว้ ใช้ตรวจว่าไฟล์ใหม่หน้าตาเหมือนไฟล์เดิมจริง
  // ชีตชื่อเดียวกัน (เช่น BOQ) จากคนละไฟล์อาจวางคอลัมน์ต่างกัน ห้ามใช้ template ทั้งที่หัวตารางไม่ตรง
  headers?: Record<string, string>
}

// template รุ่นแรกเก็บเฉพาะ mapping คอลัมน์ ต้องอ่านของเดิมได้ด้วย
export function readStoredTemplate(value: unknown): StoredTemplate | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if ('columns' in obj && obj.columns && typeof obj.columns === 'object') {
    return {
      columns: obj.columns as StoredTemplate['columns'],
      layout: (obj.layout as SheetLayout | undefined) ?? undefined,
      headers: (obj.headers as Record<string, string> | undefined) ?? undefined,
    }
  }
  return { columns: obj as StoredTemplate['columns'] }
}
