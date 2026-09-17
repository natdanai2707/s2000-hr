import { describe, it, expect } from 'vitest'
import { safeObjectName, safeExtension } from '@/lib/storage'

// อักขระที่ Supabase Storage ยอมรับใน object key (ภาษาไทยไม่อยู่ในชุดนี้)
const SUPABASE_KEY_RE = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/

const THAI_FILE = 'เสนอราคา งานแผ่นหลัง PU 2 นิ้ว.xlsx'

describe('safeExtension', () => {
  it('อ่านนามสกุลปกติ', () => {
    expect(safeExtension('boq.xlsx', 'bin')).toBe('xlsx')
    expect(safeExtension('IMG_1234.JPG', 'bin')).toBe('jpg')
  })
  it('ไฟล์ไม่มีนามสกุลใช้ค่าสำรอง ไม่เอาชื่อทั้งก้อนมาเป็นนามสกุล', () => {
    expect(safeExtension('รูปหน้างาน', 'jpg')).toBe('jpg')
    expect(safeExtension('.gitignore', 'bin')).toBe('bin')
  })
  it('นามสกุลที่มีอักขระแปลกใช้ค่าสำรอง', () => {
    expect(safeExtension('ไฟล์.เอกสาร', 'xlsx')).toBe('xlsx')
  })
})

describe('safeObjectName: ชื่อไฟล์ต้องใช้เป็น key ของ Supabase Storage ได้เสมอ', () => {
  it('ชื่อไฟล์ภาษาไทยไม่ทำให้เกิด Invalid key', () => {
    const name = safeObjectName(THAI_FILE, 'xlsx')
    expect(name).toMatch(/\.xlsx$/)
    expect(SUPABASE_KEY_RE.test(name)).toBe(true)
    expect(/[ก-๙]/.test(name)).toBe(false)
  })

  it('path เต็มที่ใช้อัปโหลดผ่านกติกาของ Storage', () => {
    const projectId = 'b2ca3412-21e0-4687-bcda-efc3de772685'
    for (const [file, ext] of [
      [THAI_FILE, 'xlsx'],
      ['รูปหน้างาน', 'jpg'],
      ['ใบเสร็จ ค่าน้ำมัน 12 ก.ย..pdf', 'pdf'],
      ['BOQ final (rev.2).xlsx', 'xlsx'],
      ['a'.repeat(200) + '.xlsx', 'xlsx'],
    ] as [string, string][]) {
      const path = `projects/${projectId}/boq/${safeObjectName(file, ext)}`
      expect(SUPABASE_KEY_RE.test(path), `key ไม่ผ่าน: ${path}`).toBe(true)
      expect(path.length).toBeLessThan(200)
    }
  })

  it('เก็บส่วนที่เป็น ASCII ของชื่อเดิมไว้ให้พออ่านออก', () => {
    expect(safeObjectName('BOQ final (rev.2).xlsx', 'xlsx')).toMatch(/-BOQfinalrev\.2\.xlsx$/)
  })

  it('ชื่อไม่ซ้ำกันแม้อัปโหลดไฟล์ชื่อเดียวกันพร้อมกัน', () => {
    const names = new Set(Array.from({ length: 200 }, () => safeObjectName(THAI_FILE, 'xlsx')))
    expect(names.size).toBe(200)
  })
})
