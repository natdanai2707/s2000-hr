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
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-card no-print">
        <div className="px-5 py-4 border-b border-border">
          <div className="font-semibold text-primary">S-2000 Project Cost Control</div>
          <div className="text-xs text-muted-foreground mt-1">{profile.full_name}</div>
          <div className="text-xs text-muted-foreground">{ROLE_LABELS[profile.role]}</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {sidebar.map(item => paused(item) ? (
            <PausedItem key={item.href} label={item.label} className="px-5 py-2.5" />
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block px-5 py-2.5 text-sm hover:bg-muted',
                isActive(pathname, item.href) ? 'bg-muted font-medium text-primary border-r-2 border-primary' : 'text-foreground',
                item.phase && 'text-muted-foreground'
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3 space-y-1">
          <Link href="/notifications" className="block px-2 py-2 text-sm hover:bg-muted rounded-md">
            แจ้งเตือน{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </Link>
          <Link href="/account" className="block px-2 py-2 text-sm hover:bg-muted rounded-md">
            เปลี่ยนรหัสผ่าน
          </Link>
          <button onClick={signOut} className="w-full text-left px-2 py-2 text-sm hover:bg-muted rounded-md">
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-card border-b border-border px-4 h-12 flex items-center justify-between no-print">
        <Link href="/" className="font-semibold text-primary text-sm">
          S-2000 Cost Control
        </Link>
        <Link href="/notifications" className="text-sm text-muted-foreground min-h-11 inline-flex items-center">
          แจ้งเตือน{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Link>
      </header>

      <main className="flex-1 md:ml-60 pb-20 md:pb-8">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-6">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {bottomItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center min-h-14 px-0.5 text-[13px] leading-tight text-center border-t-2',
                activeBottom === item.href ? 'text-primary font-semibold border-primary' : 'text-muted-foreground border-transparent'
              )}
            >
              <span>{item.label}</span>
              {item.count > 0 && <span className="text-[11px] text-danger-fg font-medium">{item.count}</span>}
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={cn('flex flex-col items-center justify-center min-h-14 text-[13px] border-t-2', moreOpen ? 'text-primary font-semibold border-primary' : 'text-muted-foreground border-transparent')}
          >
            เพิ่มเติม
          </button>
        </div>
        {moreOpen && <div className="fixed inset-0 -z-10 bg-black/30" onClick={() => setMoreOpen(false)} aria-hidden="true" />}
        {moreOpen && (
          <div className="absolute bottom-full inset-x-0 bg-card border-t border-border max-h-[70vh] overflow-y-auto rounded-t-xl shadow-lg">
            {/* เมนูที่ยังไม่เปิดใช้งาน (เฟส 2-3) ไม่แสดงบนมือถือ */}
            {sidebar.filter(item => !item.phase).map(item => paused(item) ? (
              <PausedItem key={item.href} label={item.label} className="px-5 py-3 border-b border-border" />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn('block px-5 py-3.5 text-[15px] border-b border-border', isActive(pathname, item.href) && 'font-semibold text-primary')}
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
