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
