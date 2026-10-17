// ภาษีมูลค่าเพิ่ม ราคาทุกตัวในระบบเก็บเป็นราคาไม่รวม VAT เพื่อให้เทียบกับต้นทุนใน BOQ ได้ตรงกัน
// ราคารวม VAT เป็นค่าที่คำนวณจากราคาไม่รวม VAT เสมอ ไม่ได้เก็บแยก
export const VAT_RATE_PCT = 7

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function addVat(excl: number): number {
  return round2(excl * (1 + VAT_RATE_PCT / 100))
}

export function removeVat(incl: number): number {
  return round2(incl / (1 + VAT_RATE_PCT / 100))
}

function parse(text: string): number | null {
  const t = text.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return isNaN(n) ? null : n
}

// ช่องคู่ไม่รวม/รวม VAT: ช่องที่กรอกล่าสุดเป็นตัวตั้ง อีกช่องคำนวณตาม
export interface VatPair {
  excl: string
  incl: string
}

export function pairFromExcl(text: string): VatPair {
  const n = parse(text)
  return { excl: text, incl: n === null ? '' : addVat(n).toFixed(2) }
}

export function pairFromIncl(text: string): VatPair {
  const n = parse(text)
  return { excl: n === null ? '' : removeVat(n).toFixed(2), incl: text }
}
