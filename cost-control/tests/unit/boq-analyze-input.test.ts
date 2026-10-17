import { describe, it, expect } from 'vitest'
import { gridToText } from '@/lib/boq/analyze'

describe('ข้อมูลที่ส่งให้ Claude อ่าน', () => {
  it('เซลล์สูตรแสดงผลลัพธ์ ไม่ใช่ [object Object]', () => {
    const text = gridToText([['รางสแตนเลส', 40, { formula: 'B1*850', result: 34000 }]], 45, 3)
    expect(text).toContain('34000')
    expect(text).not.toContain('[object Object]')
  })

  it('แถวยอดรวมท้ายชีตถูกส่งไปด้วยแม้เกินจำนวนแถวต้นชีต พร้อมเลขแถวจริง', () => {
    const grid: unknown[][] = Array.from({ length: 80 }, (_, i) => [`รายการ ${i + 1}`, 1, 100])
    grid[79] = ['Sub Total งานทดสอบ', '', 8000]
    const text = gridToText(grid, 45, 3)
    expect(text).toContain('r45 | รายการ 45')
    expect(text).not.toContain('r46 |')
    expect(text).toContain('r80 | Sub Total งานทดสอบ')
  })
})
