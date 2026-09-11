// แปลงแถวจากไฟล์ xlsx เป็น sections และ items ตามกติกา:
// - แถวที่ไม่มีปริมาณ (แต่มีรายการ) = หัวข้อหมวด -> boq_sections
// - แถวที่มีราคาวัสดุและราคาแรงงานแยกกัน -> แตกเป็น 2 items (material, labor) item_no เดียวกัน
import type { BoqCategory } from '@/lib/types'

export type BoqColumnKey = 'item_no' | 'description' | 'unit' | 'qty' | 'material_price' | 'labor_price' | 'total' | 'markup_pct'

export const BOQ_COLUMN_LABELS: Record<BoqColumnKey, string> = {
  item_no: 'ลำดับ',
  description: 'รายการ',
  unit: 'หน่วย',
  qty: 'ปริมาณ',
  material_price: 'ราคาวัสดุต่อหน่วย',
  labor_price: 'ราคาแรงงานต่อหน่วย',
  total: 'รวม',
  markup_pct: 'markup (%)',
}

// mapping: ชื่อคอลัมน์ในระบบ -> index คอลัมน์ในชีต (0-based) หรือ null ถ้าไม่มี
export type ColumnMapping = Partial<Record<BoqColumnKey, number | null>>

export interface RawRow {
  cells: unknown[]
}

export interface ParsedSection {
  code: string | null
  name: string
  sort_order: number
}

export interface ParsedItem {
  section_index: number | null
  item_no: string | null
  description: string
  unit: string | null
  qty: number
  unit_cost: number
  category: BoqCategory
  markup_pct: number
  sell_unit_price: number
  sort_order: number
}

export interface SplitResult {
  sections: ParsedSection[]
  items: ParsedItem[]
  skipped: number
}

export function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  if (typeof v === 'object' && v !== null && 'result' in v) return cellNumber((v as { result: unknown }).result)
  const s = String(v).replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return isNaN(n) ? null : n
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v !== null) {
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map(r => r.text).join('').trim()
    if ('result' in v) return cellText((v as { result: unknown }).result)
    if ('text' in v) return String((v as { text: unknown }).text).trim()
  }
  return String(v).trim()
}

export function autoDetectMapping(headerCells: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  headerCells.forEach((cell, idx) => {
    const h = cellText(cell).toLowerCase().replace(/\s+/g, '')
    if (!h) return
    if (mapping.item_no === undefined && /(ลำดับ|^no\.?$|^item$|รายการที่)/.test(h)) mapping.item_no = idx
    else if (mapping.description === undefined && /(รายการ|รายละเอียด|description)/.test(h)) mapping.description = idx
    else if (mapping.unit === undefined && /(หน่วย|^unit$)/.test(h)) mapping.unit = idx
    else if (mapping.qty === undefined && /(ปริมาณ|จำนวน|qty|quantity)/.test(h)) mapping.qty = idx
    else if (mapping.material_price === undefined && /(วัสดุ|material)/.test(h) && !/รวม|total|amount/.test(h)) mapping.material_price = idx
    else if (mapping.labor_price === undefined && /(แรง|ค่าแรง|labou?r)/.test(h) && !/รวม|total|amount/.test(h)) mapping.labor_price = idx
    else if (mapping.markup_pct === undefined && /(markup|กำไร|%)/.test(h)) mapping.markup_pct = idx
    else if (mapping.total === undefined && /(รวม|total|amount)/.test(h)) mapping.total = idx
  })
  return mapping
}

function pick(row: unknown[], idx: number | null | undefined): unknown {
  if (idx === null || idx === undefined) return null
  return row[idx]
}

export function splitRows(rows: unknown[][], mapping: ColumnMapping, defaultMarkupPct = 0): SplitResult {
  const sections: ParsedSection[] = []
  const items: ParsedItem[] = []
  let skipped = 0
  let currentSection: number | null = null
  let sort = 0

  for (const row of rows) {
    const description = cellText(pick(row, mapping.description))
    const qty = cellNumber(pick(row, mapping.qty))
    const itemNo = cellText(pick(row, mapping.item_no)) || null
    const unit = cellText(pick(row, mapping.unit)) || null
    const material = cellNumber(pick(row, mapping.material_price))
    const labor = cellNumber(pick(row, mapping.labor_price))
    const total = cellNumber(pick(row, mapping.total))
    const markup = cellNumber(pick(row, mapping.markup_pct)) ?? defaultMarkupPct

    if (!description) {
      skipped++
      continue
    }
    // ข้ามแถวสรุป (รวม/ยอดรวม) ที่ไม่มีลำดับและไม่มีปริมาณ
    if (qty === null || qty === 0) {
      if (/^(รวม|ยอดรวม|total|sum|grand)/i.test(description) && !itemNo) {
        skipped++
        continue
      }
      sections.push({ code: itemNo, name: description, sort_order: sections.length })
      currentSection = sections.length - 1
      continue
    }

    const hasMaterial = material !== null && material !== 0
    const hasLabor = labor !== null && labor !== 0

    const push = (category: BoqCategory, unitCost: number) => {
      const sell = unitCost * (1 + markup / 100)
      items.push({
        section_index: currentSection,
        item_no: itemNo,
        description,
        unit,
        qty,
        unit_cost: unitCost,
        category,
        markup_pct: markup,
        sell_unit_price: Math.round(sell * 100) / 100,
        sort_order: sort++,
      })
    }

    if (hasMaterial && hasLabor) {
      push('material', material)
      push('labor', labor)
    } else if (hasMaterial) {
      push('material', material)
    } else if (hasLabor) {
      push('labor', labor)
    } else if (total !== null && total !== 0) {
      // มีแต่ยอดรวมต่อแถว: ถือเป็นวัสดุ unit_cost = total / qty
      push('material', Math.round((total / qty) * 100) / 100)
    } else {
      push('material', 0)
    }
  }
  return { sections, items, skipped }
}

export interface SectionTotals {
  section_index: number | null
  name: string
  cost: number
  sell: number
  profit: number
  profit_pct: number | null
}

export function summarize(result: SplitResult): { sections: SectionTotals[]; cost: number; sell: number; profit: number; profit_pct: number | null } {
  const map = new Map<number | null, SectionTotals>()
  for (const it of result.items) {
    const key = it.section_index
    const name = key === null ? 'ไม่ระบุหมวด' : result.sections[key].name
    const cur = map.get(key) ?? { section_index: key, name, cost: 0, sell: 0, profit: 0, profit_pct: null }
    cur.cost += it.qty * it.unit_cost
    cur.sell += it.qty * it.sell_unit_price
    map.set(key, cur)
  }
  let cost = 0
  let sell = 0
  const sections = [...map.values()].map(s => {
    s.profit = s.sell - s.cost
    s.profit_pct = s.sell > 0 ? (s.profit / s.sell) * 100 : null
    cost += s.cost
    sell += s.sell
    return s
  })
  const profit = sell - cost
  return { sections, cost, sell, profit, profit_pct: sell > 0 ? (profit / sell) * 100 : null }
}
