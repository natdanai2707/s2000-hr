'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, type Profile } from '@/lib/types'
import { SIDEBAR_ITEMS, BOTTOM_ITEMS, visibleFor, type NavItem } from './nav-config'
import { createClient } from '@/lib/supabase/client'
import { OfflineSync } from './offline-sync'
import { ServiceWorkerRegister } from './sw-register'
import { ToastProvider } from './toast'

interface Props {
  profile: Profile
  pendingCount: number
  unreadCount: number
  directMode: boolean
  children: ReactNode
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

// เมนูล่างไฮไลต์อันที่ตรงที่สุดอันเดียว /pr/new ต้องไม่ไฮไลต์ทั้ง บันทึกซื้อ และ รายการซื้อ
function bestMatch(pathname: string, hrefs: string[]) {
  return hrefs.filter(h => isActive(pathname, h)).sort((a, b) => b.length - a.length)[0] ?? null
}

export function AppShell({ profile, pendingCount, unreadCount, directMode, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const sidebar = visibleFor(SIDEBAR_ITEMS, profile.role, directMode)
  const paused = (item: NavItem) => directMode && item.pausedInDirectMode

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const bottomItems = visibleFor(BOTTOM_ITEMS, profile.role, directMode).map(item => ({ ...item, count: item.href === '/approvals' ? pendingCount : 0 }))
  const activeBottom = bestMatch(pathname, bottomItems.map(i => i.href))

  return (
    <div className="min-h-screen md:flex">
      <ServiceWorkerRegister />
      <OfflineSync />
      {/* Desktop sidebar: แถบน้ำเงินเข้ม เมนูที่เลือกเป็นพื้นขาวตัวน้ำเงิน (กลับสี) เห็นชัดว่าอยู่หน้าไหน */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-primary text-primary-foreground no-print">
        <Link href="/" className="block px-5 pt-5 pb-4 border-b border-white/15">
          <div className="font-display text-xl font-bold leading-none">S-2000</div>
          <div className="font-display text-sm font-medium text-white/80 mt-1">Project Cost Control</div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {/* เมนูที่ยังไม่เปิดใช้งาน (เฟส 2-3) ไม่แสดง */}
          {sidebar.filter(item => !item.phase).map(item => paused(item) ? (
            <PausedItem key={item.href} label={item.label} className="px-3 py-2.5 text-white/45" />
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded px-3 py-2.5 text-[15px]',
                isActive(pathname, item.href) ? 'bg-white font-semibold text-primary' : 'text-white/90 hover:bg-white/10'
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/15 px-2 py-3 space-y-0.5">
          <div className="px-3 pb-2">
            <div className="text-sm font-semibold truncate">{profile.full_name}</div>
            <div className="text-xs text-white/70">{ROLE_LABELS[profile.role]}</div>
          </div>
          <Link href="/notifications" className={cn('flex items-center justify-between rounded px-3 py-2 text-sm', pathname.startsWith('/notifications') ? 'bg-white font-semibold text-primary' : 'hover:bg-white/10')}>
            แจ้งเตือน
            {unreadCount > 0 && <span className="rounded-sm bg-status-watch px-1.5 text-xs font-bold text-white">{unreadCount}</span>}
          </Link>
          <Link href="/account" className={cn('block rounded px-3 py-2 text-sm', pathname.startsWith('/account') ? 'bg-white font-semibold text-primary' : 'hover:bg-white/10')}>
            เปลี่ยนรหัสผ่าน
          </Link>
          <button onClick={signOut} className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10">
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-primary text-primary-foreground px-4 h-14 flex items-center justify-between no-print">
        <Link href="/" className="font-display leading-none">
          <span className="text-lg font-bold">S-2000</span>
          <span className="ml-1.5 text-sm font-medium text-white/80">Cost Control</span>
        </Link>
        <Link href="/notifications" className="inline-flex h-10 items-center gap-1.5 rounded border border-white/40 px-3 text-sm font-medium">
          แจ้งเตือน
          {unreadCount > 0 && <span className="rounded-sm bg-status-watch px-1.5 text-xs font-bold text-white">{unreadCount}</span>}
        </Link>
      </header>

      <main className="flex-1 md:ml-60 pb-20 md:pb-8">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-6">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t-2 border-foreground no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {bottomItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center min-h-14 px-0.5 text-[13px] leading-tight text-center',
                activeBottom === item.href ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground font-medium'
              )}
            >
              <span>{item.label}</span>
              {item.count > 0 && <span className="text-[11px] text-danger-fg font-medium">{item.count}</span>}
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={cn('flex flex-col items-center justify-center min-h-14 text-[13px]', moreOpen ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground font-medium')}
          >
            เพิ่มเติม
          </button>
        </div>
        {moreOpen && <div className="fixed inset-0 -z-10 bg-black/30" onClick={() => setMoreOpen(false)} aria-hidden="true" />}
        {moreOpen && (
          <div className="absolute bottom-full inset-x-0 bg-card border-t-2 border-foreground max-h-[70vh] overflow-y-auto shadow-lg">
            {/* เมนูที่ยังไม่เปิดใช้งาน (เฟส 2-3) ไม่แสดงบนมือถือ */}
            {sidebar.filter(item => !item.phase).map(item => paused(item) ? (
              <PausedItem key={item.href} label={item.label} className="px-5 py-3 border-b border-border" />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn('block px-5 py-3.5 text-[15px] border-b border-border', isActive(pathname, item.href) ? 'bg-primary font-semibold text-primary-foreground' : 'font-medium')}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/notifications" onClick={() => setMoreOpen(false)} className="block px-5 py-3 text-sm border-b border-border">
              แจ้งเตือน
            </Link>
            <Link href="/account" onClick={() => setMoreOpen(false)} className="block px-5 py-3 text-sm border-b border-border">
              เปลี่ยนรหัสผ่าน
            </Link>
            <button onClick={signOut} className="block w-full text-left px-5 py-3 text-sm">
              ออกจากระบบ
            </button>
          </div>
        )}
      </nav>
    </div>
  )
}

// เมนูที่ปิดชั่วคราวระหว่างโหมดบันทึกซื้อตรง แสดงเป็นสีเทาและกดไม่ได้ เปิดกลับได้เมื่อให้พนักงานใช้ขั้นตอนเต็ม
function PausedItem({ label, className }: { label: string; className?: string }) {
  return (
    <span aria-disabled="true" className={cn('block text-sm text-muted-foreground/60 cursor-not-allowed select-none', className)}>
      {label} <span className="text-xs">(ปิดชั่วคราว)</span>
    </span>
  )
}
