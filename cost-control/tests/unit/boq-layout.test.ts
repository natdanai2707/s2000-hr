import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { readSheets, detectLayout, buildPreview } from '@/lib/boq/parse'
import { splitRows } from '@/lib/boq/split'
import { readStoredTemplate } from '@/lib/boq/layout'
import { analysisEnabled, analyzeSheet } from '@/lib/boq/analyze'

// ชีตที่มีหัวกระดาษ หัวตาราง 2 แถว บล็อกสรุป แล้วจึงเป็นรายละเอียด
async function buildSheet(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('งานทดสอบ')
  const banner = (t: string, n: number) => [t, t, t, t, t, t, t, t, t, n]
  ws.addRow(['BILL OF QUANTITIES', 'BILL OF QUANTITIES', 'PROJECT', 'PROJECT', 'งานทดสอบ'])
  ws.addRow(['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', 'MATERIAL', 'MATERIAL', 'LABOUR', 'LABOUR', 'UNIT RATE', 'TOTAL'])
  ws.addRow(['ITEMS', 'DESCRIPTION', "Q'TY", 'UNIT', '@', 'SUB TOTAL', '@', 'SUB TOTAL', 'UNIT RATE', 'TOTAL'])
  ws.addRow([null, 'SUMMARY'])
  ws.addRow(['A', 'หมวดงานโครงสร้าง', 1, 'L/S', null, null, null, null, 13000, 13000])
  ws.addRow(banner('Sub Total งานทดสอบ', 13000))
  ws.addRow(banner('Total งานทดสอบ', 13000))
  ws.addRow(['A', 'หมวดงานโครงสร้าง'])
  ws.addRow(['1', 'งานฐานราก'])
  ws.addRow([null, 'คอนกรีตโครงสร้าง', 5, 'คิว', 2000, 10000, 600, 3000, 2600, 13000])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('โครงของชีตแยกออกจากการจับคู่คอลัมน์', () => {
  it('detectLayout หาหัวตาราง 2 แถวและจุดเริ่มข้อมูลได้', async () => {
    const [sheet] = await readSheets(await buildSheet())
    expect(detectLayout(sheet.grid)).toEqual({ header_row: 2, header_rows: 2, data_start_row: 4 })
  })

  it('buildPreview ใช้โครงที่ส่งเข้ามา ทำให้ข้ามบล็อกสรุปได้ถ้าตัววิเคราะห์บอกจุดเริ่มข้อมูลที่ถูก', async () => {
    const [sheet] = await readSheets(await buildSheet())
    // ค่าแบบที่ตัววิเคราะห์ควรตอบ: หัวตารางแถว 2 สองแถว ข้อมูลจริงเริ่มแถว 8 (ข้ามบล็อกสรุป)
    const preview = buildPreview(sheet.name, sheet.grid, { header_row: 2, header_rows: 2, data_start_row: 8 })
    expect(preview.headers[4]).toBe('MATERIAL @')
    expect(preview.rows).toHaveLength(3)
    expect(preview.rows[0][1]).toBe('หมวดงานโครงสร้าง')

    const mapping = { item_no: 0, description: 1, qty: 2, unit: 3, material_price: 4, labor_price: 6, total: 9 }
    const result = splitRows(preview.rows, mapping, 0)
    const cost = result.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
    expect(cost).toBe(13000)
    expect(result.items).toHaveLength(2)
  })

  it('โครงที่ผิดทำให้บล็อกสรุปถูกนับซ้ำ ยืนยันว่าจุดเริ่มข้อมูลสำคัญจริง', async () => {
    const [sheet] = await readSheets(await buildSheet())
    const preview = buildPreview(sheet.name, sheet.grid, { header_row: 2, header_rows: 2, data_start_row: 4 })
    const mapping = { item_no: 0, description: 1, qty: 2, unit: 3, material_price: 4, labor_price: 6, total: 9 }
    const result = splitRows(preview.rows, mapping, 0)
    // splitRows ยังมีกฎข้ามบล็อก SUMMARY เป็นตาข่ายรองอีกชั้น ต้นทุนจึงไม่ถูกนับซ้ำ
    const cost = result.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
    expect(cost).toBe(13000)
  })
})

describe('template ที่บันทึกไว้', () => {
  it('อ่านรูปแบบใหม่ที่เก็บทั้งคอลัมน์และโครง', () => {
    const t = readStoredTemplate({ columns: { qty: 2 }, layout: { header_row: 4, header_rows: 2, data_start_row: 33 } })
    expect(t?.columns.qty).toBe(2)
    expect(t?.layout?.data_start_row).toBe(33)
  })

  it('อ่านรูปแบบเก่าที่เก็บเฉพาะคอลัมน์ได้ ไม่พังกับข้อมูลเดิม', () => {
    const t = readStoredTemplate({ description: 1, qty: 2 })
    expect(t?.columns.qty).toBe(2)
    expect(t?.layout).toBeUndefined()
  })

  it('ค่าที่ใช้ไม่ได้คืน null', () => {
    expect(readStoredTemplate(null)).toBeNull()
    expect(readStoredTemplate('x')).toBeNull()
  })
})

describe('ทางสำรองเมื่อยังไม่ได้ตั้งค่า API', () => {
  it('ไม่มี ANTHROPIC_API_KEY ถือว่าปิดการวิเคราะห์ และ analyzeSheet คืน null ให้ผู้เรียกใช้กฎแทน', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(analysisEnabled()).toBe(false)
    await expect(analyzeSheet('งานทดสอบ', [['a']])).resolves.toBeNull()
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
  })
})
