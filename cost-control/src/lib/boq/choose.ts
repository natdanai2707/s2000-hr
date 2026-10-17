// เลือกโครงของชีตที่จะใช้แตกรายการ จาก 3 แหล่ง: template ที่บันทึกไว้, Claude อ่านให้, กฎตายตัว
// template ใช้ได้ต่อเมื่อหัวตารางของไฟล์ใหม่ตรงกับไฟล์ที่บันทึกไว้จริงและแตกรายการได้ ไม่งั้นข้ามไปใช้ Claude
// แหล่งไหนแตกได้ 0 รายการ ลองแหล่งถัดไป เพื่อไม่ให้ชีตที่อ่านได้ถูกทิ้งเพราะแหล่งแรกผิด
import { buildPreview, detectLayout, type SheetPreview } from './parse'
import { autoDetectMapping, headerScore, normalizeHeader, splitRows, type ColumnMapping, type SplitResult } from './split'
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

export function chooseLayout(name: string, grid: unknown[][], tpl: StoredTemplate | null, ai: AiLayout | null): ChosenLayout {
  const rulesLayout = detectLayout(grid)
  const rulesMapping = autoDetectMapping(buildPreview(name, grid, rulesLayout).headers)
  const candidates: ChosenLayout[] = []
  let templateRejected = false

  if (tpl) {
    const layout = tpl.layout ?? rulesLayout
    const mapping = tpl.columns as ColumnMapping
    const r = run(name, grid, layout, mapping)
    if (templateMatches(tpl, r.preview, ai?.mapping ?? rulesMapping) && r.split.items.length > 0) {
      candidates.push({ source: 'template', layout, mapping, ...r, template_rejected: false })
    } else {
      templateRejected = true
    }
  }
  if (ai) candidates.push({ source: 'ai', layout: ai.layout, mapping: ai.mapping, ...run(name, grid, ai.layout, ai.mapping), template_rejected: false })
  candidates.push({ source: 'rules', layout: rulesLayout, mapping: rulesMapping, ...run(name, grid, rulesLayout, rulesMapping), template_rejected: false })

  // Claude บอกว่าไม่ใช่ชีตรายละเอียด BOQ (เช่นปก ใบเสนอราคา) เชื่อ Claude ไม่ไล่หาแหล่งที่แตกได้
  const pick = ai && !ai.is_boq_detail_sheet ? candidates.find(c => c.source === 'ai')! : candidates.find(c => c.split.items.length > 0) ?? candidates[0]
  return { ...pick, template_rejected: templateRejected }
}
