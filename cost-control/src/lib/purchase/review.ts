// ตรวจตัวเลขที่ Claude อ่านจากเอกสารจัดซื้อ และแปลงเป็นบรรทัดสำหรับฟอร์มบันทึกการสั่งซื้อ
// การคำนวณทั้งหมดอยู่ที่นี่ ไม่ให้ Claude คำนวณ: ตรวจ ปริมาณ × ราคา = ยอดบรรทัด, ผลรวมรายการ = ยอดรวม,
// VAT 7%, ยอดสุทธิ แล้วเฉลี่ยส่วนลดท้ายบิลลงราคาต่อหน่วย และถอด VAT ถ้าราคาในเอกสารรวม VAT
import type { ExtractedDoc } from './extract'
import { suggestConversion } from '@/lib/units'
import { formatBaht, formatQty } from '@/lib/format'
import { VAT_RATE_PCT } from '@/lib/vat'

export interface BoqRef {
  id: string
  description: string
  unit: string | null
}

export interface ReviewedLine {
  description: string
  qty: number | null
  unit: string | null // หน่วยในเอกสาร
  unit_price: number | null // ต่อหน่วยในเอกสาร ไม่รวม VAT หลังหักส่วนลดท้ายบิล
  boq_item_id: string | null
  // หน่วย BOQ ต่อหนึ่งหน่วยในเอกสาร: 1 = หน่วยเดียวกัน, null = หน่วยต่างกันแต่ยังไม่รู้ตัวแปลง ผู้ใช้ต้องกรอก
  qty_factor: number | null
  note: string | null
}

export interface ReviewResult {
  lines: ReviewedLine[]
  issues: string[] // ตัวเลขในเอกสารไม่ตรงกัน อาจอ่านผิด
  notes: string[] // สิ่งที่ระบบปรับให้ เช่น ถอด VAT เฉลี่ยส่วนลด
  total_excl_vat: number | null
}

function off(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) > 1 + Math.abs(expected) * 0.0001
}

const UNIT_ALIASES: [RegExp, string][] = [
  [/^(kg|kgs|กก|กิโล|กิโลกรัม)$/, 'kg'],
  [/^(m2|sqm|ตรม|ตารางเมตร)$/, 'm2'],
  [/^(m|ม|เมตร)$/, 'm'],
  [/^(pcs|pc|ea|ชิ้น|อัน)$/, 'pcs'],
  [/^(set|ชุด)$/, 'set'],
  [/^(เส้น|ท่อน)$/, 'เส้น'],
  [/^(แผ่น|sheet)$/, 'แผ่น'],
]

export function normalizeUnit(u: string | null): string {
  const t = (u ?? '').toLowerCase().replace(/[.\s]/g, '')
  for (const [re, v] of UNIT_ALIASES) if (re.test(t)) return v
  return t
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function reviewExtraction(doc: ExtractedDoc, boq: BoqRef[]): ReviewResult {
  const issues: string[] = []
  const notes: string[] = []

  let sumLines = 0
  let sumComplete = true
  const base = doc.lines.map((l, i) => {
    const name = `บรรทัด ${i + 1} ${l.description.slice(0, 40)}`
    let price = l.unit_price
    if (price === null && l.line_total !== null && l.qty) price = l.line_total / l.qty
    if (l.qty === null) issues.push(`${name}: อ่านปริมาณไม่ได้`)
    if (price === null) issues.push(`${name}: อ่านราคาไม่ได้`)
    if (l.qty !== null && l.unit_price !== null && l.line_total !== null && off(l.line_total, l.qty * l.unit_price)) {
      issues.push(`${name}: ${formatQty(l.qty)} × ${formatBaht(l.unit_price)} = ${formatBaht(l.qty * l.unit_price)} แต่ในเอกสารเป็น ${formatBaht(l.line_total)}`)
    }
    const lineTotal = l.line_total ?? (l.qty !== null && price !== null ? l.qty * price : null)
    if (lineTotal === null) sumComplete = false
    else sumLines += lineTotal
    return { l, price }
  })

  if (sumComplete && doc.subtotal !== null && off(sumLines, doc.subtotal)) {
    issues.push(`ผลรวมรายการ ${formatBaht(sumLines)} แต่ยอดรวมในเอกสารเป็น ${formatBaht(doc.subtotal)} อาจอ่านบางบรรทัดผิดหรือขาด`)
  }
  const subtotal = doc.subtotal ?? (sumComplete ? sumLines : null)
  const discount = Math.abs(doc.discount ?? 0)
  const afterDiscount = subtotal !== null ? subtotal - discount : null
  if (afterDiscount !== null && doc.vat !== null && !doc.prices_include_vat) {
    const exp = (afterDiscount * VAT_RATE_PCT) / 100
    if (off(doc.vat, exp)) issues.push(`VAT ในเอกสาร ${formatBaht(doc.vat)} แต่ ${VAT_RATE_PCT}% ของ ${formatBaht(afterDiscount)} = ${formatBaht(exp)}`)
  }
  if (afterDiscount !== null && doc.grand_total !== null) {
    const exp = doc.prices_include_vat ? afterDiscount : afterDiscount + (doc.vat ?? 0)
    if (off(doc.grand_total, exp)) issues.push(`ยอดสุทธิในเอกสาร ${formatBaht(doc.grand_total)} แต่คำนวณได้ ${formatBaht(exp)}`)
  }

  // ส่วนลดท้ายบิลเฉลี่ยลงทุกบรรทัดตามสัดส่วน ต้นทุนจริงของแต่ละรายการจึงสะท้อนราคาที่จ่ายจริง
  const discountRatio = subtotal && subtotal > 0 && discount > 0 ? (subtotal - discount) / subtotal : 1
  if (discountRatio !== 1) notes.push(`มีส่วนลดท้ายบิล ${formatBaht(discount)} บาท ระบบเฉลี่ยลงราคาต่อหน่วยทุกบรรทัดตามสัดส่วน`)
  if (doc.prices_include_vat) notes.push('ราคาในเอกสารรวม VAT ระบบถอด VAT ออกให้ เพราะต้นทุนในระบบไม่รวม VAT')

  let totalExcl = 0
  let totalComplete = true
  const lines: ReviewedLine[] = base.map(({ l, price }) => {
    let unitPrice: number | null = null
    if (price !== null) {
      let p = price * discountRatio
      if (doc.prices_include_vat) p = p / (1 + VAT_RATE_PCT / 100)
      unitPrice = round2(p)
    }
    if (unitPrice !== null && l.qty !== null) totalExcl += unitPrice * l.qty
    else totalComplete = false

    const item = l.boq_index !== null && l.boq_index >= 0 && l.boq_index < boq.length ? boq[l.boq_index] : null
    let factor: number | null = 1
    let note = l.match_note
    if (item && l.unit && item.unit && normalizeUnit(l.unit) !== normalizeUnit(item.unit)) {
      // เหล็กที่ BOQ คิดเป็นกิโล ใช้น้ำหนักต่อเมตร × ความยาวจากชื่อรายการ BOQ ก่อน แม่นกว่าให้ Claude เดา
      const sug = normalizeUnit(l.unit) !== 'kg' ? suggestConversion(item.description, item.unit) : null
      if (sug) {
        factor = sug.factor
        note = `1 ${l.unit} = ${sug.factor} ${item.unit} (${sug.note})`
      } else if (l.qty_factor && l.qty_factor > 0) {
        factor = l.qty_factor
        note = `ตัวแปลงหน่วยจาก Claude 1 ${l.unit} = ${l.qty_factor} ${item.unit} ตรวจก่อนบันทึก${l.match_note ? ` · ${l.match_note}` : ''}`
      } else {
        factor = null
        note = `หน่วยในเอกสาร (${l.unit}) ต่างจาก BOQ (${item.unit}) กรุณากรอกตัวแปลง`
      }
    }
    return { description: l.description, qty: l.qty, unit: l.unit, unit_price: unitPrice, boq_item_id: item?.id ?? null, qty_factor: factor, note }
  })

  return { lines, issues, notes, total_excl_vat: totalComplete ? round2(totalExcl) : null }
}
