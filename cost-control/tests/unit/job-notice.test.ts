import { describe, it, expect } from 'vitest'
import { parseJobNotice, projectNameFromNotice, matchProfile, customerFromCells, cleanName } from '@/lib/project/job-notice'

const SAMPLE = `แจ้ง เปิด Job/เพิ่มแผนก
- A6911-05(V107) งานพับขั้นบันได (รวินท์)
- ผู้รับผิดชอบ ณรงค์ฤทธิ์ 
- จัดซื้อ สุวรรณญา ค่ะ
@นาย 🐻🐻ณรงค์ฤทธิ์💰💰`

describe('ข้อความแจ้งเปิด Job', () => {
  it('อ่านรหัส เลข V ชื่องาน ลูกค้า และคนตามหน้าที่', () => {
    const n = parseJobNotice(SAMPLE)
    expect(n.code).toBe('A6911-05')
    expect(n.version).toBe('V107')
    expect(n.title).toBe('งานพับขั้นบันได')
    expect(n.customer_hint).toBe('รวินท์')
    expect(projectNameFromNotice(n)).toBe('งานพับขั้นบันได (V107)')
    expect(n.people).toEqual([
      { role: 'project_manager', label: 'ผู้รับผิดชอบ', name: 'ณรงค์ฤทธิ์' },
      { role: 'purchasing', label: 'จัดซื้อ', name: 'สุวรรณญา' },
    ])
  })

  it('รูปแบบอื่น: มีเว้นวรรค ไม่มีเลข V ไม่มีลูกค้า มีโคลอน', () => {
    const n = parseJobNotice('1) B6912-01 งานโครงหลังคา\nผู้รับผิดชอบ: คุณสมชาย ครับ\nหัวหน้างาน ช่างดำ')
    expect(n.code).toBe('B6912-01')
    expect(n.version).toBeNull()
    expect(n.title).toBe('งานโครงหลังคา')
    expect(n.customer_hint).toBeNull()
    expect(n.people.map(p => [p.role, p.name])).toEqual([
      ['project_manager', 'สมชาย'],
      ['site_supervisor', 'ดำ'],
    ])
  })

  it('ตัดอีโมจิ คำนำหน้า และคำลงท้าย', () => {
    expect(cleanName('นาย 🐻🐻ณรงค์ฤทธิ์💰💰')).toBe('ณรงค์ฤทธิ์')
    expect(cleanName('สุวรรณญา ค่ะ')).toBe('สุวรรณญา')
  })
})

describe('จับคู่ชื่อกับผู้ใช้', () => {
  const profiles = [
    { id: '1', full_name: 'ณรงค์ฤทธิ์ ใจดี', role: 'project_manager' },
    { id: '2', full_name: 'สุวรรณญา ทองคำ', role: 'purchasing' },
    { id: '3', full_name: 'สมชาย วิศวกร', role: 'engineer' },
    { id: '4', full_name: 'สมชาย ผู้จัดการ', role: 'project_manager' },
  ]
  it('ชื่อต้นตรงกัน', () => {
    expect(matchProfile('ณรงค์ฤทธิ์', 'project_manager', profiles)?.id).toBe('1')
    expect(matchProfile('สุวรรณญา', 'purchasing', profiles)?.id).toBe('2')
  })
  it('ชื่อซ้ำกันเลือกคนที่หน้าที่ตรง', () => {
    expect(matchProfile('สมชาย', 'project_manager', profiles)?.id).toBe('4')
  })
  it('ไม่เจอคืน null', () => {
    expect(matchProfile('ประยุทธ', 'engineer', profiles)).toBeNull()
  })
})

describe('ชื่อลูกค้าเต็มจากไฟล์ BOQ', () => {
  it('เลือกเซลล์ที่เป็นชื่อบริษัท ไม่เอาชื่องาน', () => {
    const cells = ['บจก. รวินท์ คอนสตรัคชั่น', 'รวินท์ คอนสตรัคชั่น จำกัด', 'รวินท์ คอนสตรัคชั่น จำกัด', 'งานตัดพับขั้นบันได', 'งานของรวินท์ โครงการ']
    expect(customerFromCells('รวินท์', cells)).toBe('รวินท์ คอนสตรัคชั่น จำกัด')
  })
  it('ไม่มีชื่อย่อ คืน null', () => {
    expect(customerFromCells(null, ['รวินท์ คอนสตรัคชั่น จำกัด'])).toBeNull()
  })
})
