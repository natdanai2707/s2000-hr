import { describe, it, expect } from 'vitest'
import { filterSuppliers, normalizeSupplierName } from '@/lib/suppliers'

const list = [
  { id: '1', name: 'บจก.เหล็กใต้' },
  { id: '2', name: 'หจก. สงขลาเหล็กกล้า' },
  { id: '3', name: 'Siam Steel Trading' },
  { id: '4', name: 'ร้านวัสดุหาดใหญ่' },
]

describe('ค้นหาซัพพลายเออร์', () => {
  it('พิมพ์บางส่วนของชื่อ กรองเฉพาะที่มีคำนั้น ชื่อที่ขึ้นต้นด้วยคำนั้นมาก่อน', () => {
    expect(filterSuppliers(list, 'เหล็ก').map(s => s.id)).toEqual(['1', '2'])
    expect(filterSuppliers(list, 'บจก').map(s => s.id)).toEqual(['1'])
  })

  it('ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างซ้ำ', () => {
    expect(filterSuppliers(list, 'siam  STEEL').map(s => s.id)).toEqual(['3'])
    expect(normalizeSupplierName('  บจก.เหล็กใต้  ')).toBe(normalizeSupplierName('บจก.เหล็กใต้'))
  })

  it('ช่องว่าง แสดงรายชื่อทั้งหมดตามจำนวนที่จำกัด', () => {
    expect(filterSuppliers(list, '', 3)).toHaveLength(3)
  })

  it('ไม่มีชื่อที่ตรง คืนรายการว่าง', () => {
    expect(filterSuppliers(list, 'ไม่มีบริษัทนี้')).toEqual([])
  })
})
