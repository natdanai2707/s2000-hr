import type { UserRole } from '@/lib/types'

export interface NavItem {
  href: string
  label: string
  roles?: UserRole[] // ไม่ระบุ = ทุก role
  phase?: 2 | 3 // เมนูที่ยังไม่เปิดใช้งานในเฟส 1
  pausedInDirectMode?: boolean // ปิดชั่วคราวระหว่างโหมดบันทึกซื้อตรง กดไม่ได้
  hiddenInDirectMode?: boolean
  directOnly?: boolean // แสดงเฉพาะระหว่างโหมดบันทึกซื้อตรง
  directLabel?: string // ชื่อเมนูระหว่างโหมดบันทึกซื้อตรง
}

// Desktop sidebar เรียงตามสเปก ชื่อไทยล้วน ไม่มีไอคอน
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/', label: 'แดชบอร์ด', directLabel: 'ภาพรวมต้นทุน' },
  { href: '/projects', label: 'โครงการ' },
  { href: '/pr', label: 'ใบขอซื้อ', directLabel: 'รายการสั่งซื้อ' },
  { href: '/po', label: 'ใบสั่งซื้อ', pausedInDirectMode: true },
  { href: '/receiving', label: 'รับของ', pausedInDirectMode: true },
  { href: '/finance', label: 'การรับของและชำระเงิน', directLabel: 'ใบแจ้งหนี้และชำระเงิน' },
  { href: '/schedule', label: 'แผนงาน', phase: 2 },
  { href: '/progress', label: 'ความก้าวหน้า', phase: 2 },
  { href: '/closeout', label: 'ปิดโครงการ', phase: 3 },
  { href: '/issues', label: 'บันทึกปัญหา', phase: 3 },
  { href: '/prices', label: 'ฐานราคาวัสดุ', phase: 3 },
  { href: '/admin/users', label: 'ผู้ใช้และสิทธิ์', roles: ['admin'], phase: 3 },
  { href: '/settings', label: 'ตั้งค่า', roles: ['management'], phase: 3 },
]

export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/', label: 'หน้าหลัก', directLabel: 'ภาพรวม' },
  { href: '/pr/new', label: 'ขอซื้อ', directLabel: 'บันทึกซื้อ' },
  { href: '/pr', label: 'รายการซื้อ', directOnly: true },
  { href: '/progress', label: 'ความก้าวหน้า', phase: 2, hiddenInDirectMode: true },
  { href: '/approvals', label: 'รออนุมัติ', hiddenInDirectMode: true },
  { href: '/projects', label: 'โครงการ', directOnly: true },
]

export function visibleFor(items: NavItem[], role: UserRole, directMode = false): NavItem[] {
  return items
    .filter(i => !i.roles || i.roles.includes(role))
    .filter(i => (directMode ? !i.hiddenInDirectMode : !i.directOnly))
    .map(i => (directMode && i.directLabel ? { ...i, label: i.directLabel } : i))
}
