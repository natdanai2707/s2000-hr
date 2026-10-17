import { describe, it, expect } from 'vitest'
import { addVat, removeVat, pairFromExcl, pairFromIncl } from '@/lib/vat'

describe('VAT 7%', () => {
  it('คำนวณราคารวมและไม่รวม VAT ปัดทศนิยม 2 ตำแหน่ง', () => {
    expect(addVat(100)).toBe(107)
    expect(removeVat(107)).toBe(100)
    expect(addVat(30000)).toBe(32100)
    expect(removeVat(100)).toBe(93.46)
  })

  it('กรอกช่องไม่รวม VAT ช่องรวม VAT คำนวณตาม', () => {
    expect(pairFromExcl('1000')).toEqual({ excl: '1000', incl: '1070.00' })
  })

  it('กรอกช่องรวม VAT ช่องไม่รวม VAT คำนวณตาม', () => {
    expect(pairFromIncl('1070')).toEqual({ excl: '1000.00', incl: '1070' })
  })

  it('ช่องที่กรอกทีหลังเป็นตัวตั้ง: กรอกผิดในช่องรวม VAT แล้วมากรอกช่องไม่รวม VAT ช่องรวม VAT เปลี่ยนตาม', () => {
    const wrong = pairFromIncl('5000')
    expect(wrong.excl).toBe('4672.90')
    const fixed = pairFromExcl('5000')
    expect(fixed).toEqual({ excl: '5000', incl: '5350.00' })
  })

  it('ลบตัวเลขออกทั้งช่อง อีกช่องว่างตาม', () => {
    expect(pairFromExcl('')).toEqual({ excl: '', incl: '' })
    expect(pairFromIncl('')).toEqual({ excl: '', incl: '' })
  })
})
