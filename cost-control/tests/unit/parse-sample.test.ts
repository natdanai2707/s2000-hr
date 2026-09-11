import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { parseWorkbook } from '@/lib/boq/parse'
import { autoDetectMapping, splitRows } from '@/lib/boq/split'
import { SAMPLE_BOQ } from '../../scripts/boq-sample-data'

describe('นำเข้าไฟล์ BOQ ตัวอย่างมาตรฐาน S-2000', () => {
  it('หาแถวหัวตาราง จับคู่คอลัมน์ และแตกเป็นหมวด/รายการได้ถูกต้อง', async () => {
    const buf = readFileSync(path.resolve(__dirname, '../../docs/samples/boq-sample.xlsx'))
    const sheets = await parseWorkbook(buf)
    expect(sheets).toHaveLength(1)
    const sheet = sheets[0]
    expect(sheet.header_row).toBe(4)
    expect(sheet.preview).toHaveLength(20)
    const mapping = autoDetectMapping(sheet.headers)
    expect(mapping).toMatchObject({ item_no: 0, description: 1, unit: 2, qty: 3, material_price: 4, labor_price: 5, total: 6 })
    const result = splitRows(sheet.rows, mapping, 12)
    expect(result.sections.map(s => s.name)).toEqual(['งานโครงสร้างเหล็ก', 'งานสถาปัตยกรรม', 'งานระบบ'])
    const expectedItems = SAMPLE_BOQ.filter(r => r.qty !== null).reduce((n, r) => n + (r.material ? 1 : 0) + (r.labor ? 1 : 0), 0)
    expect(result.items).toHaveLength(expectedItems)
    expect(result.skipped).toBe(1) // แถวรวมทั้งสิ้น
    const cost = result.items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
    const expectedCost = SAMPLE_BOQ.reduce((s, r) => s + (r.qty ?? 0) * ((r.material ?? 0) + (r.labor ?? 0)), 0)
    expect(cost).toBeCloseTo(expectedCost, 2)
  })
})
