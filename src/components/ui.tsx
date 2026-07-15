'use client'

import { useRouter, usePathname } from 'next/navigation'
import { ButtonHTMLAttributes, ReactNode } from 'react'

/* ============================================================
   S-2000 HR — Shared UI Components
   ปุ่ม/ชิปสถานะ/empty state/หัวข้อ/แถบเมนูล่าง แบบเดียวกันทั้งแอป
   touch target ขั้นต่ำ 44px (min-h-11)
   ============================================================ */

// ---------- Button ----------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:opacity-50',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50',
  danger: 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  fullWidth?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  fullWidth,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 font-medium text-sm transition disabled:cursor-not-allowed ${buttonVariants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

// ---------- StatusChip (แหล่งเดียวของสี/ข้อความสถานะทั้งแอป) ----------
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

const statusConfig: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'รออนุมัติ', className: 'bg-[var(--color-pending-bg)] text-[var(--color-pending-fg)]' },
  approved: { label: 'อนุมัติแล้ว', className: 'bg-[var(--color-approved-bg)] text-[var(--color-approved-fg)]' },
  rejected: { label: 'ไม่อนุมัติ', className: 'bg-[var(--color-rejected-bg)] text-[var(--color-rejected-fg)]' },
  cancelled: { label: 'ยกเลิก', className: 'bg-[var(--color-neutral-bg)] text-[var(--color-neutral-fg)]' },
}

export function StatusChip({ status }: { status: string }) {
  const cfg = statusConfig[status as RequestStatus] ?? statusConfig.cancelled
  return (
    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

export function statusText(status: string): string {
  return (statusConfig[status as RequestStatus] ?? statusConfig.cancelled).label
}

// ---------- EmptyState ----------
export function EmptyState({
  icon = '📭',
  title,
  hint,
  action,
}: {
  icon?: string
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-gray-700 font-medium text-sm">{title}</p>
      {hint && <p className="text-gray-400 text-xs mt-1.5 max-w-xs mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

// ---------- FieldError (ข้อความ validation ใต้ field) ----------
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return <p className="text-red-500 text-xs mt-1">{message}</p>
}

// ---------- PageHeader ----------
export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
}) {
  const router = useRouter()
  return (
    <div className="bg-white border-b border-gray-100 px-2 py-2.5 flex items-center gap-1 sticky top-0 z-20">
      <button
        onClick={onBack || (() => router.back())}
        aria-label="ย้อนกลับ"
        className="tap-target text-gray-500 text-xl rounded-lg hover:bg-gray-100"
      >
        ‹
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="font-semibold text-gray-800 truncate">{title}</h1>
        {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

// ---------- BottomNav (เมนูหลัก แทนการกด back ไปมา) ----------
const navItems = [
  { href: '/dashboard', label: 'หน้าหลัก', icon: '🏠' },
  { href: '/calendar', label: 'ปฏิทิน', icon: '📅' },
  { href: '/attendance', label: 'เช็คอิน', icon: '📍' },
  { href: '/requests', label: 'ประวัติ', icon: '📜' },
]

export function BottomNav() {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto grid grid-cols-4">
        {navItems.map(item => {
          const active = pathname === item.href
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-14 py-1.5 transition ${
                active ? 'text-brand-600' : 'text-gray-400'
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span className={`text-[11px] ${active ? 'font-semibold' : ''}`}>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
