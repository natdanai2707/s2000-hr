import { describe, it, expect } from 'vitest'
import { maskThaiDate, parseThaiDate, formatThaiDate } from '@/lib/date'

describe('ช่องวันที่ วัน/เดือน/ปี', () => {
  it('ใส่ / ให้อัตโนมัติระหว่างพิมพ์', () => {
    expect(maskThaiDate('3')).toBe('3')
    expect(maskThaiDate('301')).toBe('30/1')
    expect(maskThaiDate('30112569')).toBe('30/11/2569')
    expect(maskThaiDate('30/11/25691')).toBe('30/11/2569')
  })

  it('ปี พ.ศ. แปลงเป็น ค.ศ. ก่อนเก็บ และปี ค.ศ. ก็รับได้', () => {
    expect(parseThaiDate('30/11/2569')).toBe('2026-11-30')
    expect(parseThaiDate('30/11/2026')).toBe('2026-11-30')
    expect(parseThaiDate('1/2/2570')).toBe('2027-02-01')
  })

  it('วันที่ไม่มีจริงหรือยังพิมพ์ไม่ครบ คืนค่าว่าง', () => {
    expect(parseThaiDate('31/02/2569')).toBe('')
    expect(parseThaiDate('12/13/2569')).toBe('')
    expect(parseThaiDate('30/11/25')).toBe('')
    expect(parseThaiDate('')).toBe('')
  })

  it('แสดงกลับเป็น วัน/เดือน/ปี พ.ศ. ตรงกับที่พิมพ์', () => {
    expect(formatThaiDate(parseThaiDate('05/03/2570'))).toBe('05/03/2570')
  })
})
