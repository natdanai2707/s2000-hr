// ตรวจตัวเลขที่ผู้ประมาณราคาคำนวณไว้ในไฟล์ BOQ และหามูลค่าสัญญา (ก่อน VAT)
//
// การคำนวณทั้งหมดทำด้วยโค้ด แม่นถึงสตางค์ ส่วน Claude (ถ้ามี) ช่วยแค่บอกว่าแถวไหนเป็นแถวยอดรวมแบบไหน
// และเซลล์ไหนคือมูลค่าสัญญา ถ้าไม่มี Claude ใช้กฎจากข้อความในแถวแทน
//
// สิ่งที่ตรวจ
// 1. รายบรรทัด: ปริมาณ × ราคาวัสดุ = รวมค่าวัสดุ, ปริมาณ × ค่าแรง = รวมค่าแรง,
//    วัสดุ + ค่าแรง = ราคาต่อหน่วยรวม, ปริมาณ × ราคาต่อหน่วยรวม = ยอดรวมบรรทัด
// 2. ยอดรวมหมวด = ผลรวมยอดรวมบรรทัดในหมวด, ยอดรวมหมวดใหญ่ = ผลรวมยอดรวมหมวดย่อย
// 3. สายยอดสรุป: Sub Total = ผลรวมทุกรายการ, ค่าดำเนินการ x% = x% ของ Sub Total,
//    Total = Sub Total + ค่าดำเนินการ − ส่วนลด, VAT = 7% ของยอดก่อน VAT, ยอดรวม VAT = ยอดก่อน VAT + VAT
import { cellNumber, cellText, DEDUCTION_RE, type ColumnMapping } from './split'
import type { SheetLayout } from './layout'
import { formatBaht, formatQty } from '@/lib/format'
import { removeVat, VAT_RATE_PCT } from '@/lib/vat'

export type SummaryKind = 'section_total' | 'group_total' | 'sub_total' | 'overhead' | 'discount' | 'total' | 'vat' | 'grand_total'

export interface CheckIssue {
  row: number // เลขแถวใน Excel
  label: string
  message: string
  in_file: number
  expected: number
}

export interface ContractCandidate {
  amount: number
  row: number
  label: string
  // true เมื่อพบแถว VAT ต่อจากยอดนี้ จึงมั่นใจว่าเป็นยอดก่อน VAT
  before_vat: boolean
  source: 'ai' | 'rules'
}

export interface SheetCheck {
  checked: number
  issues: CheckIssue[]
  contract: ContractCandidate | null
}

export interface AiCell {
  row: number
  column: number
  includes_vat: boolean
}

export interface VerifyOptions {
  roles?: Map<number, SummaryKind> // จาก Claude: เลขแถว Excel -> ชนิดแถวยอดรวม
  contractCell?: AiCell | null
}

// ยอมให้ต่างได้ 1 บาท บวกเศษจากการปัดของยอดใหญ่ ตัวเลขที่ Excel คำนวณเองจะตรงเป๊ะ
function tolerance(expected: number): number {
  return 1 + Math.abs(expected) * 0.00001
}

function off(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) > tolerance(expected)
}

// ข้อความแรกของแถวที่ไม่ใช่ตัวเลขล้วน ใช้บอกว่าแถวนี้เป็นแถวอะไร
function rowLabel(row: unknown[]): { text: string; col: number } | null {
  for (let c = 0; c < row.length; c++) {
    const t = cellText(row[c])
    if (t && cellNumber(row[c]) === null) return { text: t, col: c }
  }
  return null
}

export function classifyLabel(label: string): SummaryKind | null {
  const t = label.trim()
  if (/^sub\s*-?\s*total|^รวมย่อย/i.test(t)) return 'sub_total'
  if (/overhead|ค่าดำเนินการ|กำไร/i.test(t)) return 'overhead'
  if (/ส่วนลด|discount/i.test(t)) return 'discount'
  if (/^(vat\b|ภาษีมูลค่าเพิ่ม)/i.test(t)) return 'vat'
  if (/grand\s*total|รวมเงินทั้งสิ้น/i.test(t)) return 'grand_total'
  if (/^(total|รวม)/i.test(t)) return 'total'
  return null
}

function percentOf(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? Number(m[1]) : null
}

function rowValue(row: unknown[], mapping: ColumnMapping, labelCol: number): number | null {
  const atTotal = mapping.total != null ? cellNumber(row[mapping.total]) : null
  if (atTotal !== null) return atTotal
  for (let c = labelCol + 1; c < row.length; c++) {
    const n = cellNumber(row[c])
    if (n !== null) return n
  }
  return null
}

function num(row: unknown[], idx: number | null | undefined): number | null {
  if (idx === null || idx === undefined) return null
  return cellNumber(row[idx])
}

interface ChainRow {
  row: number
  kind: SummaryKind
  label: string
  value: number
  pct: number | null
}

export function verifySheet(grid: unknown[][], layout: SheetLayout, mapping: ColumnMapping, opts: VerifyOptions = {}): SheetCheck {
  const issues: CheckIssue[] = []
  let checked = 0
  const report = (row: number, label: string, message: string, inFile: number, expected: number) =>
    issues.push({ row, label, message, in_file: inFile, expected: Math.round(expected * 100) / 100 })

  const firstRow = layout.header_row + layout.header_rows // แถวแรกหลังหัวตาราง (1-based)
  let inSummaryBlock = false
  let deduction = false
  let sectionSum = 0
  let sectionHasItems = false
  let groupSum = 0
  let groupHasSections = false
  // มีแถวค่าดำเนินการ ส่วนลด หรือ VAT หลังยอดหมวดล่าสุด แปลว่ายอดถัดไปเป็นยอดสรุป ไม่ใช่ยอดหมวด
  let adjustedSinceSection = false
  let sheetSum = 0
  let sheetItems = 0
  const chain: ChainRow[] = []

  for (let r = firstRow; r <= grid.length; r++) {
    const row = grid[r - 1] ?? []
    const texts = row.map(cellText).filter(Boolean)
    if (texts.length === 0) continue

    // บล็อก SUMMARY ด้านบนของ BOQ แบบ S-2000 ไม่ใช่รายการจริง แต่แถวยอดสรุปในบล็อกยังต้องตรวจ
    if (!inSummaryBlock && texts.some(t => /^summary$/i.test(t))) {
      inSummaryBlock = true
      continue
    }
    const inSummaryZone = inSummaryBlock || r < layout.data_start_row

    const label = rowLabel(row)
    const kind = opts.roles?.get(r) ?? (label ? classifyLabel(label.text) : null)
    const description = cellText(num(row, mapping.description) === null && mapping.description != null ? row[mapping.description] : '')
    const qtyRaw = num(row, mapping.qty)

    if (kind && label) {
      const value = rowValue(row, mapping, label.col)
      if (inSummaryBlock && /^total\b/i.test(label.text)) inSummaryBlock = false
      if (value === null) continue

      const isGeneric = kind === 'total' && !opts.roles?.has(r) && !adjustedSinceSection
      if (!inSummaryZone && (kind === 'overhead' || kind === 'discount' || kind === 'vat')) adjustedSinceSection = true
      if (kind === 'sub_total') groupHasSections = false
      if (kind === 'section_total' || (isGeneric && !inSummaryZone && sectionHasItems)) {
        checked++
        if (off(Math.abs(value), Math.abs(sectionSum))) {
          report(r, label.text, `ยอดรวมหมวด ${formatBaht(value)} แต่ผลรวมรายการในหมวด = ${formatBaht(Math.abs(sectionSum))}`, value, Math.abs(sectionSum))
        }
        groupSum += Math.abs(value)
        groupHasSections = true
        sectionSum = 0
        sectionHasItems = false
        adjustedSinceSection = false
        chain.push({ row: r, kind: 'section_total', label: label.text, value, pct: null })
        continue
      }
      if (kind === 'group_total' || (isGeneric && !inSummaryZone && groupHasSections)) {
        checked++
        if (off(Math.abs(value), groupSum)) {
          report(r, label.text, `ยอดรวมหมวดใหญ่ ${formatBaht(value)} แต่ผลรวมหมวดย่อย = ${formatBaht(groupSum)}`, value, groupSum)
        }
        groupSum = 0
        groupHasSections = false
        chain.push({ row: r, kind: 'group_total', label: label.text, value, pct: null })
        continue
      }
      chain.push({ row: r, kind, label: label.text, value, pct: percentOf(label.text) })
      continue
    }

    if (inSummaryZone) continue

    // หัวข้อหมวด: ไม่มีปริมาณ
    if (qtyRaw === null || qtyRaw === 0) {
      if (description) {
        if (DEDUCTION_RE.test(description)) deduction = true
        else if (/หมวด/.test(description) || /^[A-Z]$/.test(cellText(row[mapping.item_no ?? -1] ?? ''))) deduction = false
      }
      continue
    }
    if (!description) continue

    // รายการ: ตรวจเลขในบรรทัด
    const qty = Math.abs(qtyRaw)
    const mat = num(row, mapping.material_price)
    const lab = num(row, mapping.labor_price)
    const matT = num(row, mapping.material_total)
    const labT = num(row, mapping.labor_total)
    const rate = num(row, mapping.unit_rate)
    const tot = num(row, mapping.total)
    const name = description.slice(0, 80)

    if (mat !== null && matT !== null) {
      checked++
      if (off(matT, qty * mat)) report(r, name, `รวมค่าวัสดุ ${formatBaht(matT)} แต่ ${formatQty(qty)} × ${formatBaht(mat)} = ${formatBaht(qty * mat)}`, matT, qty * mat)
    }
    if (lab !== null && labT !== null) {
      checked++
      if (off(labT, qty * lab)) report(r, name, `รวมค่าแรง ${formatBaht(labT)} แต่ ${formatQty(qty)} × ${formatBaht(lab)} = ${formatBaht(qty * lab)}`, labT, qty * lab)
    }
    const unitFromParts = mat !== null || lab !== null ? (mat ?? 0) + (lab ?? 0) : null
    if (rate !== null && unitFromParts !== null) {
      checked++
      if (off(rate, unitFromParts)) report(r, name, `ราคาต่อหน่วยรวม ${formatBaht(rate)} แต่ค่าวัสดุ + ค่าแรง = ${formatBaht(unitFromParts)}`, rate, unitFromParts)
    }
    const unit = rate ?? unitFromParts
    if (tot !== null && unit !== null) {
      checked++
      if (off(tot, qty * unit)) report(r, name, `ยอดรวมบรรทัด ${formatBaht(tot)} แต่ ${formatQty(qty)} × ${formatBaht(unit)} = ${formatBaht(qty * unit)}`, tot, qty * unit)
    }

    const rowTotal = tot ?? (unit !== null ? qty * unit : 0)
    sectionSum += rowTotal
    sectionHasItems = true
    adjustedSinceSection = false
    sheetSum += deduction ? -rowTotal : rowTotal
    sheetItems++
  }

  // สายยอดสรุป ตรวจหลังอ่านครบทั้งชีต เพราะบล็อกสรุปของ S-2000 อยู่ก่อนรายละเอียด
  // base = ยอดล่าสุดที่ใช้ตั้งต้น, adds/subs = รายการบวกและส่วนลดที่ยังไม่ถูกรวมเข้ายอดถัดไป
  type Point = { value: number; row: ChainRow }
  let base: Point | null = null
  let adds = 0
  let subs = 0
  let beforeVat: Point | null = null
  let lastSummary: Point | null = null
  for (const c of chain) {
    switch (c.kind) {
      case 'section_total':
      case 'group_total':
        base = { value: Math.abs(c.value), row: c }
        adds = 0
        subs = 0
        break
      case 'sub_total':
        if (sheetItems > 0) {
          checked++
          if (off(c.value, sheetSum)) report(c.row, c.label, `Sub Total ${formatBaht(c.value)} แต่ผลรวมทุกรายการ = ${formatBaht(sheetSum)}`, c.value, sheetSum)
        }
        base = { value: c.value, row: c }
        lastSummary = base
        adds = 0
        subs = 0
        break
      case 'overhead':
        if (base && c.pct !== null) {
          checked++
          const exp = (base.value * c.pct) / 100
          if (off(c.value, exp)) report(c.row, c.label, `${c.pct}% ของ ${formatBaht(base.value)} = ${formatBaht(exp)} แต่ในไฟล์เป็น ${formatBaht(c.value)}`, c.value, exp)
        }
        adds += c.value
        break
      case 'discount':
        subs += Math.abs(c.value)
        break
      case 'vat':
        if (base) {
          const pre: Point = { value: base.value + adds - subs, row: base.row }
          beforeVat = beforeVat ?? pre
          checked++
          const pct = c.pct ?? VAT_RATE_PCT
          const exp = (pre.value * pct) / 100
          if (off(c.value, exp)) report(c.row, c.label, `VAT ${pct}% ของ ${formatBaht(pre.value)} = ${formatBaht(exp)} แต่ในไฟล์เป็น ${formatBaht(c.value)}`, c.value, exp)
          base = pre
        }
        adds = c.value
        subs = 0
        break
      default: {
        // total / grand_total ต้องเท่ากับยอดก่อนหน้า + รายการบวก − ส่วนลด
        if (base && (adds !== 0 || subs !== 0)) {
          checked++
          const exp = base.value + adds - subs
          if (off(c.value, exp)) {
            const parts = [formatBaht(base.value), adds ? `+ ${formatBaht(adds)}` : '', subs ? `− ${formatBaht(subs)}` : ''].filter(Boolean).join(' ')
            report(c.row, c.label, `ยอดในไฟล์ ${formatBaht(c.value)} แต่ ${parts} = ${formatBaht(exp)}`, c.value, exp)
          }
        } else if (!base && sheetItems > 0) {
          checked++
          if (off(c.value, sheetSum)) report(c.row, c.label, `ยอดรวม ${formatBaht(c.value)} แต่ผลรวมทุกรายการ = ${formatBaht(sheetSum)}`, c.value, sheetSum)
        }
        base = { value: c.value, row: c }
        lastSummary = base
        adds = 0
        subs = 0
      }
    }
  }

  // มูลค่าสัญญา: ยอดก่อน VAT ถ้ามีแถว VAT ไม่งั้นยอดสรุปสุดท้าย (เช่น Total หลังค่าดำเนินการ)
  let contract: ContractCandidate | null = null
  if (beforeVat) contract = { amount: beforeVat.value, row: beforeVat.row.row, label: beforeVat.row.label, before_vat: true, source: 'rules' }
  else if (lastSummary) contract = { amount: lastSummary.value, row: lastSummary.row.row, label: lastSummary.row.label, before_vat: false, source: 'rules' }

  const cell = opts.contractCell
  if (cell) {
    const v = cellNumber(grid[cell.row - 1]?.[cell.column])
    if (v !== null && v > 0) {
      contract = {
        amount: cell.includes_vat ? removeVat(v) : v,
        row: cell.row,
        label: rowLabel(grid[cell.row - 1] ?? [])?.text ?? '',
        before_vat: true,
        source: 'ai',
      }
    }
  }

  return { checked, issues, contract }
}

// เลือกมูลค่าสัญญาของทั้งไฟล์ ใบเสนอราคาที่มีแถว VAT น่าเชื่อที่สุด เพราะเป็นยอดที่ลูกค้าเห็นจริงหลังส่วนลด
// ถ้าไม่มีใบเสนอราคา ใช้ผลรวมยอดสุดท้ายของชีตรายละเอียดที่นำเข้า
export interface ContractSuggestion {
  amount: number
  sheet: string
  row: number | null
  label: string
  source: 'ai' | 'rules'
}

export function suggestContract(
  sheets: { name: string; is_detail: boolean; included: boolean; contract: ContractCandidate | null }[]
): ContractSuggestion | null {
  const summaries = sheets.filter(s => !s.is_detail && s.contract)
  const best = summaries.find(s => s.contract!.source === 'ai') ?? summaries.find(s => s.contract!.before_vat) ?? summaries[0]
  if (best) {
    const c = best.contract!
    return { amount: Math.round(c.amount * 100) / 100, sheet: best.name, row: c.row, label: c.label, source: c.source }
  }
  const details = sheets.filter(s => s.is_detail && s.included && s.contract)
  if (details.length === 0) return null
  const amount = details.reduce((sum, s) => sum + s.contract!.amount, 0)
  return {
    amount: Math.round(amount * 100) / 100,
    sheet: details.map(s => s.name).join(', '),
    row: details.length === 1 ? details[0].contract!.row : null,
    label: details.length === 1 ? details[0].contract!.label : 'รวมยอดสุดท้ายของทุกชีตที่นำเข้า',
    source: details.some(s => s.contract!.source === 'ai') ? 'ai' : 'rules',
  }
}
