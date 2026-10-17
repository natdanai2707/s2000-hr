// แปลงหน่วยที่ซื้อจริงกับหน่วยใน BOQ เช่น BOQ คิดเหล็กเป็นกิโล แต่ร้านขายเป็นเส้น
// factor = จำนวนหน่วย BOQ ต่อหนึ่งหน่วยที่ซื้อ (1 เส้น = 299.4 kg)

export interface ConversionSuggestion {
  factor: number
  unit: string
  note: string
}

const KG_UNITS = new Set(['kg', 'kgs', 'กก', 'กิโลกรัม', 'กิโล'])

// เหล็กรูปพรรณที่ BOQ คิดเป็นกิโล และรายการบอกน้ำหนักต่อเมตรกับความยาวต่อเส้น
// เช่น "H-BEAM 200x200x8x12 mm.(49.9 kg/m.)SS400 (Size 6 m.)" -> 1 เส้น = 49.9 × 6 = 299.4 kg
export function suggestConversion(description: string, boqUnit: string | null): ConversionSuggestion | null {
  const unit = (boqUnit ?? '').toLowerCase().replace(/[.\s]/g, '')
  if (!KG_UNITS.has(unit)) return null
  const perM = description.match(/(\d+(?:\.\d+)?)\s*(?:kg|กก\.?)\s*\.?\s*\/\s*(?:m|ม)(?![a-z])/i)
  const len = description.match(/(?:size|ยาว|length|l\s*=)\s*(\d+(?:\.\d+)?)\s*(?:m|ม)(?![a-z])/i)
  if (!perM || !len) return null
  const kgPerM = Number(perM[1])
  const lengthM = Number(len[1])
  if (!(kgPerM > 0) || !(lengthM > 0)) return null
  return { factor: Math.round(kgPerM * lengthM * 1000) / 1000, unit: 'เส้น', note: `${kgPerM} kg/m × ${lengthM} m` }
}

// ปริมาณและราคาในหน่วย BOQ จากปริมาณและราคาในหน่วยที่ซื้อ ยอดเงินเท่าเดิมเสมอ
export function toBoqUnits(qty: number, unitPrice: number, factor: number): { qty: number; unitPrice: number } {
  if (!(factor > 0)) return { qty, unitPrice }
  // ปัดราคาต่อหน่วย BOQ 4 ตำแหน่ง กันเศษจากการหาร เช่น 9,185.59 ÷ 299.4 = 30.679998 ต้องเท่ากับต้นทุน 30.68
  return { qty: qty * factor, unitPrice: Math.round((unitPrice / factor) * 10000) / 10000 }
}
