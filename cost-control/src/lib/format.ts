// ตัวเลขเงินแสดงเป็นบาท มีลูกน้ำคั่นหลักพัน ทศนิยม 2 ตำแหน่ง

const bahtFormatter = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  return isNaN(n) ? 0 : n
}

export function formatBaht(value: unknown): string {
  return bahtFormatter.format(toNumber(value))
}

export function formatBahtLabel(value: unknown): string {
  return `${formatBaht(value)} บาท`
}

export function formatPct(value: unknown, digits = 1): string {
  if (value === null || value === undefined || value === '') return '-'
  return `${toNumber(value).toFixed(digits)}%`
}

export function formatQty(value: unknown): string {
  const n = toNumber(value)
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 }).format(n)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
