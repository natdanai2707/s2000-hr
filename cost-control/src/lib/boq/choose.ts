// เลือกโครงของชีตที่จะใช้แตกรายการ จาก 3 แหล่ง: Claude อ่านให้, template ที่บันทึกไว้, กฎตายตัว
// Claude อ่านไฟล์ใหม่ทุกครั้งและมาก่อน template ใช้เฉพาะเมื่อ Claude ไม่ทำงาน และหัวตารางตรงกับไฟล์ที่บันทึกไว้จริง
// แหล่งไหนแตกได้ 0 รายการ ลองแหล่งถัดไป เพื่อไม่ให้ชีตที่อ่านได้ถูกทิ้งเพราะแหล่งแรกผิด
import { buildPreview, detectLayout, type SheetPreview } from './parse'
import { autoDetectMapping, detectCostColumns, headerScore, normalizeHeader, splitRows, type ColumnMapping, type SplitResult } from './split'
import type { SheetLayout, StoredTemplate } from './layout'

export type LayoutSource = 'template' | 'ai' | 'rules'

export interface AiLayout {
  layout: SheetLayout
  mapping: ColumnMapping
  is_boq_detail_sheet: boolean
}

export interface ChosenLayout {
  source: LayoutSource
  layout: SheetLayout
  mapping: ColumnMapping
  preview: SheetPreview
  split: SplitResult
  // template ชื่อชีตนี้มีอยู่ แต่ไม่ตรงกับไฟล์นี้ จึงไม่ได้ใช้
  template_rejected: boolean
}

// คอลัมน์ที่ชี้ตัวเลขเงินและปริมาณ ถ้าตำแหน่งต่างจากไฟล์เดิม ตัวเลขทั้งชีตจะผิด
const KEY_COLUMNS = ['description', 'qty', 'material_price', 'labor_price', 'total'] as const

export function templateHeaders(headers: unknown[], mapping: ColumnMapping): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, idx] of Object.entries(mapping)) {
    if (idx === null || idx === undefined) continue
    out[key] = normalizeHeader(headers[idx])
  }
  return out
}

function templateMatches(tpl: StoredTemplate, preview: SheetPreview, fresh: ColumnMapping): boolean {
  if (headerScore(preview.headers) === 0) return false
  if (tpl.headers) {
    return Object.entries(tpl.headers).every(([key, saved]) => {
      const idx = tpl.columns[key]
      return idx === null || idx === undefined || normalizeHeader(preview.headers[idx]) === saved
    })
  }
  // template รุ่นเก่าไม่มีชื่อหัวคอลัมน์เก็บไว้ ใช้ได้เฉพาะเมื่อตำแหน่งคอลัมน์หลักตรงกับที่อ่านได้ใหม่
  return KEY_COLUMNS.every(k => (tpl.columns[k] ?? null) === (fresh[k] ?? null))
}

function run(name: string, grid: unknown[][], layout: SheetLayout, mapping: ColumnMapping) {
  const preview = buildPreview(name, grid, layout)
  return { preview, split: splitRows(preview.rows, mapping, 0) }
}

const COST_KEYS = ['material_cost', 'labor_cost', 'material_cost_total', 'labor_cost_total'] as const

function withoutCost(mapping: ColumnMapping): ColumnMapping {
  const out = { ...mapping }
  for (const k of COST_KEYS) delete out[k]
  return out
}

// คอลัมน์ต้นทุนต้องอ่านใหม่จากไฟล์นี้ทุกครั้ง ห้ามใช้ตำแหน่งที่จำจากไฟล์ก่อน เพราะแต่ละงานวางคอลัมน์ต้นทุนไม่ตรงกัน
// Claude เลือกคอลัมน์ต้นทุนจากการอ่านไฟล์ แล้วโค้ดตรวจว่าคอลัมน์นั้นมีตัวเลขต้นทุนจริงในบรรทัดรายการ
// ถ้าคอลัมน์ที่เลือกว่างเกือบทั้งหมด (ทุกรายการจะใช้ราคาขายเป็นต้นทุน) ลองคอลัมน์ที่หัวคอลัมน์ในไฟล์นี้บอกว่าเป็นต้นทุน
// แล้วใช้ชุดที่มีต้นทุนครบกว่า ผู้ใช้เปลี่ยนเองหรือปิดได้ในหน้านำเข้า
function bestCostMapping(name: string, grid: unknown[][], layout: SheetLayout, base: ColumnMapping, own: ColumnMapping, found: ColumnMapping) {
  const options = [{ ...base, ...own }, { ...base, ...found }, base]
  let best: { mapping: ColumnMapping; preview: SheetPreview; split: SplitResult } | null = null
  for (const mapping of options) {
    const r = run(name, grid, layout, mapping)
    const covered = r.split.cost_mode ? r.split.items.length - r.split.missing_cost_items : 0
    const bestCovered = best ? (best.split.cost_mode ? best.split.items.length - best.split.missing_cost_items : 0) : -1
    if (covered > bestCovered) best = { mapping, ...r }
  }
  return best!
}

export function chooseLayout(name: string, grid: unknown[][], tpl: StoredTemplate | null, ai: AiLayout | null): ChosenLayout {
  const found = detectCostColumns(grid)
  const rulesLayout = detectLayout(grid)
  const rulesBase = autoDetectMapping(buildPreview(name, grid, rulesLayout).headers)
  const candidates: ChosenLayout[] = []
  let templateRejected = false

  // Claude อ่านไฟล์นี้ใหม่ทุกครั้ง ใช้ผลของ Claude ก่อน template ที่จำจากไฟล์ก่อน
  if (ai) {
    const r = bestCostMapping(name, grid, ai.layout, withoutCost(ai.mapping), ai.mapping, found)
    candidates.push({ source: 'ai', layout: ai.layout, ...r, template_rejected: false })
  }
  if (tpl && !ai) {
    const layout = tpl.layout ?? rulesLayout
    const base = withoutCost(tpl.columns as ColumnMapping)
    const r = bestCostMapping(name, grid, layout, base, {}, found)
    if (templateMatches(tpl, r.preview, rulesBase) && r.split.items.length > 0) {
      candidates.push({ source: 'template', layout, ...r, template_rejected: false })
    } else {
      templateRejected = true
    }
  }
  candidates.push({ source: 'rules', layout: rulesLayout, ...bestCostMapping(name, grid, rulesLayout, rulesBase, {}, found), template_rejected: false })

  // Claude บอกว่าไม่ใช่ชีตรายละเอียด BOQ (เช่นปก ใบเสนอราคา) เชื่อ Claude ไม่ไล่หาแหล่งที่แตกได้
  const pick = ai && !ai.is_boq_detail_sheet ? candidates.find(c => c.source === 'ai')! : candidates.find(c => c.split.items.length > 0) ?? candidates[0]
  return { ...pick, template_rejected: templateRejected }
}
