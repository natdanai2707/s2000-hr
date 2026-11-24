import type { UserRole } from '@/lib/types'
import type { IconName } from './icons'

export interface NavItem {
  href: string
  label: string
  roles?: UserRole[] // ไม่ระบุ = ทุก role
  phase?: 2 | 3 // เมนูที่ยังไม่เปิดใช้งานในเฟส 1
  pausedInDirectMode?: boolean // ปิดชั่วคราวระหว่างโหมดบันทึกซื้อตรง กดไม่ได้
  hiddenInDirectMode?: boolean
  directOnly?: boolean // แสดงเฉพาะระหว่างโหมดบันทึกซื้อตรง
  directLabel?: string // ชื่อเมนูระหว่างโหมดบันทึกซื้อตรง
  icon: IconName
  group?: NavGroup
}

export type NavGroup = 'daily' | 'finance' | 'settings'
export const NAV_GROUP_LABELS: Record<NavGroup, string> = { daily: 'งานประจำวัน', finance: 'การเงิน', settings: 'ตั้งค่า' }

// Desktop sidebar จัดเป็นกลุ่ม มีไอคอนกำกับ เมนูเฟส 2-3 ยังไม่แสดง
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/', label: 'แดชบอร์ด', directLabel: 'ภาพรวมต้นทุน', icon: 'home', group: 'daily' },
  { href: '/projects', label: 'โครงการ', icon: 'folder', group: 'daily' },
  { href: '/pr', label: 'ใบขอซื้อ', directLabel: 'รายการสั่งซื้อ', icon: 'list', group: 'daily' },
  { href: '/approvals', label: 'รออนุมัติ', icon: 'check', group: 'daily', hiddenInDirectMode: true },
  { href: '/po', label: 'ใบสั่งซื้อ', pausedInDirectMode: true, icon: 'cart', group: 'daily' },
  { href: '/receiving', label: 'รับของ', pausedInDirectMode: true, icon: 'truck', group: 'daily' },
  { href: '/finance', label: 'การรับของและชำระเงิน', directLabel: 'ใบแจ้งหนี้และชำระเงิน', icon: 'wallet', group: 'finance' },
  { href: '/billing', label: 'วางบิลและรับเงิน', roles: ['accounting', 'management', 'admin'], icon: 'bill', group: 'finance' },
  { href: '/schedule', label: 'แผนงาน', phase: 2, icon: 'calendar' },
  { href: '/progress', label: 'ความก้าวหน้า', phase: 2, icon: 'list' },
  { href: '/closeout', label: 'ปิดโครงการ', phase: 3, icon: 'folder' },
  { href: '/issues', label: 'บันทึกปัญหา', phase: 3, icon: 'alert' },
  { href: '/prices', label: 'ฐานราคาวัสดุ', phase: 3, icon: 'list' },
  { href: '/admin/users', label: 'ผู้ใช้และสิทธิ์', roles: ['management', 'admin'], icon: 'users', group: 'settings' },
  { href: '/settings', label: 'ตั้งค่า', roles: ['management'], phase: 3, icon: 'key' },
]

// เมนูล่างบนมือถือ 4 ปุ่ม + เพิ่มเติม ไอคอนอยู่บนชื่อ
export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/', label: 'หน้าหลัก', icon: 'home' },
  { href: '/pr/new', label: 'ขอซื้อ', directLabel: 'บันทึกซื้อ', icon: 'camera' },
  { href: '/pr', label: 'รายการซื้อ', directOnly: true, icon: 'list' },
  { href: '/approvals', label: 'รออนุมัติ', hiddenInDirectMode: true, icon: 'check' },
  { href: '/projects', label: 'โครงการ', icon: 'folder' },
]

export function visibleFor(items: NavItem[], role: UserRole, directMode = false): NavItem[] {
  return items
    .filter(i => !i.roles || i.roles.includes(role))
    .filter(i => (directMode ? !i.hiddenInDirectMode : !i.directOnly))
    .map(i => (directMode && i.directLabel ? { ...i, label: i.directLabel } : i))
}
