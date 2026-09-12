import type { UserRole } from '@/lib/types'

export interface NavItem {
  href: string
  label: string
  roles?: UserRole[] // ไม่ระบุ = ทุก role
  phase?: 2 | 3 // เมนูที่ยังไม่เปิดใช้งานในเฟส 1
}

// Desktop sidebar เรียงตามสเปก ชื่อไทยล้วน ไม่มีไอคอน
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/', label: 'แดชบอร์ด' },
  { href: '/projects', label: 'โครงการ' },
  { href: '/pr', label: 'ใบขอซื้อ' },
  { href: '/po', label: 'ใบสั่งซื้อ' },
  { href: '/finance', label: 'การรับของและชำระเงิน' },
  { href: '/schedule', label: 'แผนงาน', phase: 2 },
  { href: '/progress', label: 'ความก้าวหน้า', phase: 2 },
  { href: '/closeout', label: 'ปิดโครงการ', phase: 3 },
  { href: '/issues', label: 'บันทึกปัญหา', phase: 3 },
  { href: '/prices', label: 'ฐานราคาวัสดุ', phase: 3 },
  { href: '/admin/users', label: 'ผู้ใช้และสิทธิ์', roles: ['admin'], phase: 3 },
  { href: '/settings', label: 'ตั้งค่า', roles: ['management'], phase: 3 },
]

export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/', label: 'หน้าหลัก' },
  { href: '/pr/new', label: 'ขอซื้อ' },
  { href: '/progress', label: 'ความก้าวหน้า', phase: 2 },
  { href: '/approvals', label: 'รออนุมัติ' },
]

export function visibleFor(items: NavItem[], role: UserRole): NavItem[] {
  return items.filter(i => !i.roles || i.roles.includes(role))
}
