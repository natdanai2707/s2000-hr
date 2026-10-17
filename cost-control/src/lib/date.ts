// Date helpers ผูกกับ timezone Asia/Bangkok
// เก็บใน DB เป็น ISO (YYYY-MM-DD) แสดงผลเป็น วว/ดด/ปปปป แบบ พ.ศ.

export const BANGKOK_TZ = 'Asia/Bangkok'

export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function nowISO(): string {
  return new Date().toISOString()
}

// YYYY-MM-DD หรือ timestamp -> วว/ดด/ปปปป (พ.ศ.)
export function formatThaiDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = value.length <= 10 ? new Date(value + 'T12:00:00Z') : new Date(value)
  if (isNaN(d.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const year = Number(get('year')) + 543
  return `${get('day')}/${get('month')}/${year}`
}

// timestamp -> วว/ดด/ปปปป ชช:นน
export function formatThaiDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  const time = new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${formatThaiDate(value)} ${time}`
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime()
  const b = new Date(toISO + 'T00:00:00Z').getTime()
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}

// ข้อความที่ผู้ใช้พิมพ์ -> รูปแบบ วว/ดด/ปปปป ใส่ / ให้อัตโนมัติระหว่างพิมพ์
export function maskThaiDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

// วว/ดด/ปปปป -> YYYY-MM-DD รับได้ทั้ง พ.ศ. และ ค.ศ. (ปีตั้งแต่ 2400 ถือเป็น พ.ศ.) คืน '' ถ้าไม่ใช่วันที่จริง
export function parseThaiDate(text: string): string {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return ''
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year >= 2400) year -= 543
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return ''
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
