// Date helpers ที่ผูกกับ timezone Asia/Bangkok (UTC+7)
// ระบบทั้งหมดใช้เวลาไทย ห้ามใช้ new Date().toISOString().split('T')[0] ตรงๆ
// เพราะ toISOString() เป็น UTC จะได้วันที่ผิดในช่วงเที่ยงคืน - 07:00 น. ตามเวลาไทย

export const BANGKOK_TZ = 'Asia/Bangkok'

// วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD
export function todayISO(): string {
  // en-CA format = YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// เดือนปัจจุบันตามเวลาไทย รูปแบบ YYYY-MM
export function currentMonthISO(): string {
  return todayISO().slice(0, 7)
}

// ช่วงวันแรก-วันสุดท้ายของเดือน (YYYY-MM) — วันสุดท้ายคำนวณจริง ไม่ hardcode 31
export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, '0')}`,
  }
}

// ไล่วันที่จาก start ถึง end (รวมปลายทาง) เป็น array ของ YYYY-MM-DD
// ใช้ UTC ล้วนภายในเพื่อเลี่ยงปัญหา offset (ไทยไม่มี DST)
export function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = []
  if (!start || !end) return out
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return out
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// จำนวนวันแบบรวมปลายทาง (inclusive) ระหว่างสองวันที่
export function daysBetweenInclusive(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start + 'T00:00:00Z').getTime()
  const e = new Date(end + 'T00:00:00Z').getTime()
  if (isNaN(s) || isNaN(e)) return 0
  const diff = Math.round((e - s) / 86400000) + 1
  return diff > 0 ? diff : 0
}

// แสดงวันที่ YYYY-MM-DD เป็นภาษาไทย
export function formatThaiDate(
  dateStr: string,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00Z')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('th-TH', { timeZone: BANGKOK_TZ, ...opts })
}

// แสดงเวลาจาก ISO timestamp เป็น HH:mm ตามเวลาไทย
export function formatThaiTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('th-TH', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
}

// instant ปัจจุบันเป็น ISO (UTC) — ใช้กับคอลัมน์ timestamptz ได้ถูกต้อง
export function nowISO(): string {
  return new Date().toISOString()
}
