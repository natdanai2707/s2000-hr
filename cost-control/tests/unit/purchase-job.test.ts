import { describe, it, expect } from 'vitest'
import { matchProjectByJob } from '@/lib/purchase/job'

const projects = [
  { id: 'p99', code: 'A6910-04', name: 'A6910-04(V099) งานรื้อและติดตั้งแผ่นหลังคา หลังที่ 1' },
  { id: 'p100', code: 'A6910-05', name: 'งานรื้อและติดตั้งแผ่นหลังคา หลังที่ 2 Line C-D (V100)' },
  { id: 'p98', code: 'A6909-12(V098)', name: 'งานรางน้ำยางสแตนเลส' },
]

describe('เลือกโครงการจากเลข JOB ในเอกสารจัดซื้อ', () => {
  it('รหัสงานตรงกับรหัสโครงการ', () => {
    expect(matchProjectByJob('A6910-05(V100) / 6492', projects)).toBe('p100')
    expect(matchProjectByJob('JOB: a6909-12 (v098)', projects)).toBe('p98')
  })

  it('รหัสงานต้องตรงทั้งก้อน ไม่ตรงบางส่วน', () => {
    expect(matchProjectByJob('A6910-0', projects)).toBeNull()
    expect(matchProjectByJob('A6910-051', projects)).toBeNull()
  })

  it('รหัสงานซ้ำหลายโครงการ ใช้เลขเวอร์ชันแยก ถ้ายังกำกวมไม่เลือก', () => {
    const dup = [
      { id: 'v1', code: 'A7001-01', name: 'งานโครงหลังคา (V101)' },
      { id: 'v2', code: 'A7001-01', name: 'งานโครงหลังคา (V102)' },
    ]
    expect(matchProjectByJob('A7001-01(V102)', dup)).toBe('v2')
    expect(matchProjectByJob('A7001-01', dup)).toBeNull()
  })

  it('ไม่มีเลขงานหรือไม่ตรงโครงการใด ไม่เลือก', () => {
    expect(matchProjectByJob(null, projects)).toBeNull()
    expect(matchProjectByJob('6492', projects)).toBeNull()
    expect(matchProjectByJob('B1234-01', projects)).toBeNull()
  })
})
