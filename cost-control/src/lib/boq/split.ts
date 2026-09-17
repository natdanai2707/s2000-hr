// แปลงแถวจากไฟล์ xlsx เป็น sections และ items ตามกติกา:
// - แถวที่ไม่มีปริมาณ (แต่มีรายการ) = หัวข้อหมวด -> boq_sections
// - แถวที่มีราคาวัสดุและราคาแรงงานแยกกัน -> แตกเป็น 2 items (material, labor) item_no เดียวกัน
// รองรับรูปแบบ BOQ มาตรฐานของ S-2000 ที่มีหัวตาราง 2 แถว (MATERIAL/LABOUR + @/SUB TOTAL)
// และมีบล็อก SUMMARY กับ Sub Total อยู่เหนือรายละเอียด ซึ่งต้องไม่ถูกนับเป็นรายการ
import type { BoqCategory } from '@/lib/types'

export type BoqColumnKey =
  | 'item_no'
  | 'description'
  | 'unit'
  | 'qty'
  | 'material_price'
  | 'labor_price'
  | 'total'
  | 'markup_pct'

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

export interface ParsedSection {
  code: string | null // ชื่อหมวดใหญ่ที่ครอบอยู่ ถ้ามี
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
  // หัวข้อที่ดูเหมือนเป็นงานลด (VO) ระบบนำเข้าเป็นต้นทุนบวกตามไฟล์ ต้องให้ผู้ใช้ตัดสินใจเอง
  deduction_headings: string[]
}

export function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellNumber(o.result)
    return null
  }
  const s = String(v).replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return isNaN(n) ? null : n
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return ''
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    if ('richText' in o) return (o.richText as { text: string }[]).map(r => r.text).join('').trim()
    if ('result' in o) return cellText(o.result)
    if ('text' in o) return String(o.text).trim()
    if ('error' in o) return ''
    return ''
  }
  return String(v).trim()
}

// ตัดช่องว่าง จุด และเครื่องหมายวรรคตอนที่ทำให้จับคู่ชื่อคอลัมน์พลาด เช่น Q'TY -> qty
function normalizeHeader(v: unknown): string {
  return cellText(v)
    .toLowerCase()
    .replace(/[\s'’`´.\-_/\\]/g, '')
}

const HEADER_PATTERNS: { key: BoqColumnKey; re: RegExp; not?: RegExp }[] = [
  { key: 'item_no', re: /^(ลำดับ|รายการที่|items?|no|ลำดับที่)$/ },
  { key: 'description', re: /(รายการ|รายละเอียด|description)/ },
  { key: 'unit', re: /^(หน่วย|unit)$/ },
  { key: 'qty', re: /(ปริมาณ|จำนวน|qty|quantity)/, not: /(เงิน|amount|บาท)/ },
  { key: 'material_price', re: /(วัสดุ|material)/, not: /(รวม|total|amount|subtotal)/ },
  { key: 'labor_price', re: /(ค่าแรง|แรงงาน|labou?r)/, not: /(รวม|total|amount|subtotal)/ },
  { key: 'markup_pct', re: /(markup|กำไร|%)/ },
  { key: 'total', re: /(รวม|total|amount|จำนวนเงิน)/, not: /(วัสดุ|material|ค่าแรง|แรงงาน|labou?r|unitrate)/ },
]

// ให้คะแนนว่าแถวนี้หน้าตาเหมือนหัวตารางแค่ไหน ใช้เลือกแถวหัวตารางที่ถูกต้อง
export function headerScore(cells: unknown[]): number {
  const hit = new Set<BoqColumnKey>()
  let hasDescription = false
  let hasQtyOrUnit = false
  for (const cell of cells) {
    const h = normalizeHeader(cell)
    if (!h) continue
    for (const p of HEADER_PATTERNS) {
      if (p.re.test(h) && !(p.not && p.not.test(h))) {
        hit.add(p.key)
        if (p.key === 'description') hasDescription = true
        if (p.key === 'qty' || p.key === 'unit') hasQtyOrUnit = true
      }
    }
  }
  if (!hasDescription || !hasQtyOrUnit) return 0
  return hit.size
}

// หัวตาราง 2 แถวจะมีชื่อคอลัมน์ซ้ำกันหลายช่อง (ITEMS, DESCRIPTION, Q'TY, UNIT ...)
export function isTwoRowHeader(first: unknown[], second: unknown[]): boolean {
  if (second.length === 0) return false
  let same = 0
  let secondHasText = 0
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    const a = normalizeHeader(first[i])
    const b = normalizeHeader(second[i])
    if (b) secondHasText++
    if (a && b && a === b) same++
  }
  return same >= 2 && secondHasText >= same
}

// รวมหัวตาราง 2 แถวเป็นชื่อเดียว เช่น MATERIAL + @ -> "MATERIAL @"
export function combineHeaderRows(first: unknown[], second: unknown[]): string[] {
  const n = Math.max(first.length, second.length)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const a = cellText(first[i])
    const b = cellText(second[i])
    if (!a) out.push(b)
    else if (!b || normalizeHeader(a) === normalizeHeader(b)) out.push(a)
    else out.push(`${a} ${b}`)
  }
  return out
}

export function autoDetectMapping(headerCells: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  headerCells.forEach((cell, idx) => {
    const h = normalizeHeader(cell)
    if (!h) return
    for (const p of HEADER_PATTERNS) {
      if (mapping[p.key] !== undefined) continue
      if (p.re.test(h) && !(p.not && p.not.test(h))) {
        mapping[p.key] = idx
        return
      }
    }
  })
  return mapping
}

function pick(row: unknown[], idx: number | null | undefined): unknown {
  if (idx === null || idx === undefined) return null
  return row[idx]
}

// แถวสรุปยอดที่ต้องข้าม ไม่ใช่รายการงาน
const TOTAL_ROW_RE = /^(sub\s*total|subtotal|total|grand\s*total|overhead|รวมทั้งสิ้น|ยอดรวม|รวมเป็นเงิน|รวม)/i
const NOTE_ROW_RE = /^(หมายเหตุ|remark|note)/i
// หัวข้อที่บอกว่าเป็นงานลดใน VO เช่น "หมวดงานสถาปัตย์ (ตามสัญญาเดิม) งานลด"
const DEDUCTION_RE = /(งานลด|ลดงาน|\(ลด\)|รายการลด|deduct|omit)/i

export function splitRows(rows: unknown[][], mapping: ColumnMapping, defaultMarkupPct = 0): SplitResult {
  const sections: ParsedSection[] = []
  const items: ParsedItem[] = []
  let skipped = 0
  let sort = 0

  // หมวดที่ยังไม่มีรายการอยู่ข้างใต้ จะถูกสร้างจริงเมื่อเจอรายการแรกเท่านั้น
  // ทำให้บรรทัดอย่าง SUMMARY หมายเหตุ หรือหมวดเปล่า ไม่กลายเป็นหมวดค้างในระบบ
  let pending: string[] = []
  let activeSection: number | null = null
  let lastParent: string | null = null
  let inSummary = false
  const deductions = new Set<string>()

  for (const row of rows) {
    const description = cellText(pick(row, mapping.description))
    const rawItemNo = cellText(pick(row, mapping.item_no))
    // ช่องที่ merge กันทั้งแถวจะทำให้ลำดับกับรายการเป็นข้อความเดียวกัน ถือว่าไม่มีลำดับ
    const itemNo = rawItemNo && rawItemNo !== description ? rawItemNo : ''
    const allText = row.map(cellText).filter(Boolean)

    // บล็อก SUMMARY ด้านบนของชีต สรุปยอดต่อหมวด ต้องไม่ถูกนับซ้ำกับรายละเอียดด้านล่าง
    if (!inSummary && allText.some(t => /^summary$/i.test(t))) {
      inSummary = true
      skipped++
      continue
    }
    if (inSummary) {
      skipped++
      if (allText.some(t => /^total\b/i.test(t))) inSummary = false
      continue
    }

    if (!description) {
      skipped++
      continue
    }
    if (!itemNo && (TOTAL_ROW_RE.test(description) || NOTE_ROW_RE.test(description))) {
      skipped++
      continue
    }

    const qty = cellNumber(pick(row, mapping.qty))
    if (qty === null || qty === 0) {
      pending.push(description)
      if (DEDUCTION_RE.test(description)) deductions.add(description)
      continue
    }

    const materialCell = pick(row, mapping.material_price)
    const laborCell = pick(row, mapping.labor_price)
    const material = cellNumber(materialCell)
    const labor = cellNumber(laborCell)
    const total = cellNumber(pick(row, mapping.total))
    const markup = cellNumber(pick(row, mapping.markup_pct)) ?? defaultMarkupPct
    const unit = cellText(pick(row, mapping.unit)) || null

    // ถ้าชีตมีคอลัมน์ราคาต่อหน่วย แต่แถวนี้ว่างทั้งสองช่อง แปลว่าเป็นแถวสรุปยอด ไม่ใช่รายการ
    // (เช่นบรรทัด "หมวดงานรื้อถอน 1 L/S 297,940" ในบล็อกสรุป)
    const priceCellsFilled = cellText(materialCell) !== '' || cellText(laborCell) !== ''

    // สร้างหมวดจริงตอนเจอรายการแรก ใช้หมวดย่อยสุดเป็นชื่อ และหมวดที่ครอบอยู่เป็น code
    if (pending.length > 0) {
      const name = pending[pending.length - 1]
      const parent: string | null = pending.length > 1 ? pending[pending.length - 2] : lastParent
      sections.push({ code: parent, name, sort_order: sections.length })
      activeSection = sections.length - 1
      lastParent = parent
      pending = []
    }

    const push = (category: BoqCategory, unitCost: number) => {
      const sell = unitCost * (1 + markup / 100)
      items.push({
        section_index: activeSection,
        item_no: itemNo || null,
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

    const hasMaterial = material !== null && material !== 0
    const hasLabor = labor !== null && labor !== 0

    if (hasMaterial && hasLabor) {
      push('material', material)
      push('labor', labor)
    } else if (hasMaterial) {
      push('material', material)
    } else if (hasLabor) {
      push('labor', labor)
    } else if (priceCellsFilled) {
      // ช่องราคามีข้อความอย่าง By Owner แปลว่าผู้ว่าจ้างจัดหาให้ ต้นทุนของเราเป็นศูนย์
      push('material', 0)
    } else if (total !== null && total !== 0) {
      // ชีตที่มีแต่ยอดรวมต่อแถว: ต้นทุนต่อหน่วย = รวม หารด้วย ปริมาณ
      push('material', Math.round((total / qty) * 100) / 100)
    } else {
      push('material', 0)
    }
  }
  return { sections, items, skipped, deduction_headings: [...deductions] }
}

export interface SectionTotals {
  section_index: number | null
  name: string
  cost: number
  sell: number
  profit: number
  profit_pct: number | null
}

export function summarize(result: SplitResult): {
  sections: SectionTotals[]
  cost: number
  sell: number
  profit: number
  profit_pct: number | null
} {
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
