'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, type Profile } from '@/lib/types'
import { SIDEBAR_ITEMS, BOTTOM_ITEMS, NAV_GROUP_LABELS, visibleFor, type NavGroup, type NavItem } from './nav-config'
import { Icon } from './icons'
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

  const counts: Record<string, number> = { '/approvals': pendingCount }
  const bottomItems = visibleFor(BOTTOM_ITEMS, profile.role, directMode).filter(i => !i.phase).slice(0, 4)
  const activeBottom = moreOpen ? null : bestMatch(pathname, bottomItems.map(i => i.href))
  // เมนูเฟส 2-3 และเมนูที่ปิดชั่วคราวระหว่างโหมดบันทึกซื้อตรงไม่แสดง ลดความรก
  const menu = sidebar.filter(item => !item.phase && !paused(item))
  const groups = (Object.keys(NAV_GROUP_LABELS) as NavGroup[])
    .map(g => ({ key: g, title: NAV_GROUP_LABELS[g], items: menu.filter(i => i.group === g) }))
    .filter(g => g.items.length > 0)

  const navLink = (item: NavItem, onClick?: () => void) => {
    if (paused(item)) return <PausedItem key={item.href} item={item} />
    const active = isActive(pathname, item.href)
    const count = counts[item.href] ?? 0
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-2.5 rounded px-2.5 text-[15px]',
          active ? 'bg-sidebar-active font-bold text-white' : 'text-white/90 hover:bg-white/10'
        )}
      >
        <Icon name={item.icon} size={18} />
        <span className="flex-1">{item.label}</span>
        {count > 0 && <CountBadge n={count} />}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-canvas md:flex">
      <ServiceWorkerRegister />
      <OfflineSync />
      {/* Desktop sidebar: น้ำเงินเข้ม เมนูจัดกลุ่มพร้อมไอคอน ปุ่มบันทึกซื้ออยู่บนสุด ตัวเลขงานค้างอยู่ข้างชื่อเมนู */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-sidebar text-white no-print">
        <Link href="/" className="block px-5 pt-5 pb-4">
          <span className="font-display text-[22px] font-bold leading-none">S-2000</span>
          <span className="ml-1.5 font-display text-sm font-medium text-white/75">Cost Control</span>
        </Link>
        <div className="px-3 pb-3">
          <Link href="/pr/new" className="flex h-11 items-center justify-center gap-2 rounded bg-white text-[15px] font-bold text-sidebar hover:bg-white/90">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            {directMode ? 'บันทึกการสั่งซื้อ' : 'ขอซื้อ'}
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4" aria-label="เมนูหลัก">
          {groups.map(g => (
            <div key={g.key} className="space-y-0.5">
              <div className="px-2.5 pb-1 text-xs font-semibold text-sidebar-muted">{g.title}</div>
              {g.items.map(item => navLink(item))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/15 px-3 py-3 space-y-0.5">
          <div className="px-2.5 pb-2">
            <div className="text-sm font-semibold truncate">{profile.full_name}</div>
            <div className="text-xs text-sidebar-muted">{ROLE_LABELS[profile.role]}</div>
          </div>
          <Link href="/notifications" className={cn('flex min-h-10 items-center gap-2.5 rounded px-2.5 text-sm', pathname.startsWith('/notifications') ? 'bg-sidebar-active font-bold' : 'hover:bg-white/10')}>
            <Icon name="bell" size={18} />
            <span className="flex-1">แจ้งเตือน</span>
            {unreadCount > 0 && <CountBadge n={unreadCount} />}
          </Link>
          <Link href="/account" className={cn('flex min-h-10 items-center gap-2.5 rounded px-2.5 text-sm', pathname.startsWith('/account') ? 'bg-sidebar-active font-bold' : 'hover:bg-white/10')}>
            <Icon name="key" size={18} />
            เปลี่ยนรหัสผ่าน
          </Link>
          <button onClick={signOut} className="flex min-h-10 w-full items-center gap-2.5 rounded px-2.5 text-left text-sm hover:bg-white/10">
            <Icon name="logout" size={18} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-primary text-primary-foreground pl-4 pr-1 h-14 flex items-center justify-between no-print">
        <Link href="/" className="font-display leading-none">
          <span className="text-xl font-bold">S-2000</span>
          <span className="ml-1.5 text-sm font-medium text-white/80">Cost Control</span>
        </Link>
        <Link href="/notifications" aria-label={unreadCount > 0 ? `แจ้งเตือน ${unreadCount} รายการ` : 'แจ้งเตือน'} className="relative flex h-12 w-12 items-center justify-center">
          <Icon name="bell" size={24} />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-foreground">{unreadCount}</span>
          )}
        </Link>
      </header>

      <main className="flex-1 md:ml-64 pb-24 md:pb-8">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-7">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </main>

      {/* Mobile bottom navigation: ไอคอนบนชื่อ ปุ่มที่อยู่มีแถบน้ำเงินด้านบนและตัวหนา */}
      <nav aria-label="เมนูหลัก" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-input no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {bottomItems.map(item => {
            const active = activeBottom === item.href
            const count = counts[item.href] ?? 0
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 border-t-[3px] px-0.5 text-[12px] leading-tight text-center',
                  active ? 'border-primary text-primary font-bold' : 'border-transparent text-foreground/80 font-medium'
                )}
              >
                <Icon name={item.icon} size={24} />
                <span>{item.label}</span>
                {count > 0 && <span className="absolute left-1/2 top-1.5 ml-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-foreground">{count}</span>}
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            className={cn(
              'flex min-h-[64px] flex-col items-center justify-center gap-0.5 border-t-[3px] text-[12px]',
              moreOpen ? 'border-primary text-primary font-bold' : 'border-transparent text-foreground/80 font-medium'
            )}
          >
            <Icon name="more" size={24} strokeWidth={2.6} />
            เพิ่มเติม
          </button>
        </div>
        {moreOpen && <div className="fixed inset-0 -z-10 bg-black/30" onClick={() => setMoreOpen(false)} aria-hidden="true" />}
        {moreOpen && (
          <div className="absolute bottom-full inset-x-0 max-h-[75vh] overflow-y-auto rounded-t-lg bg-sidebar px-3 pb-3 pt-4 text-white shadow-lg space-y-4">
            {groups.map(g => (
              <div key={g.key} className="space-y-0.5">
                <div className="px-2.5 pb-1 text-xs font-semibold text-sidebar-muted">{g.title}</div>
                {g.items.map(item => navLink(item, () => setMoreOpen(false)))}
              </div>
            ))}
            <div className="space-y-0.5 border-t border-white/15 pt-3">
              <div className="px-2.5 pb-1 text-xs text-sidebar-muted">{profile.full_name} · {ROLE_LABELS[profile.role]}</div>
              <Link href="/account" onClick={() => setMoreOpen(false)} className="flex min-h-11 items-center gap-2.5 rounded px-2.5 text-[15px] hover:bg-white/10">
                <Icon name="key" size={18} />
                เปลี่ยนรหัสผ่าน
              </Link>
              <button onClick={signOut} className="flex min-h-11 w-full items-center gap-2.5 rounded px-2.5 text-left text-[15px] hover:bg-white/10">
                <Icon name="logout" size={18} />
                ออกจากระบบ
              </button>
            </div>
          </div>
        )}
      </nav>
    </div>
  )
}

function CountBadge({ n }: { n: number }) {
  return <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-foreground">{n}</span>
}

// เมนูที่ปิดชั่วคราวระหว่างโหมดบันทึกซื้อตรง แสดงเป็นสีเทาและกดไม่ได้ เปิดกลับได้เมื่อให้พนักงานใช้ขั้นตอนเต็ม
function PausedItem({ item }: { item: NavItem }) {
  return (
    <span aria-disabled="true" className="flex min-h-11 cursor-not-allowed select-none items-center gap-2.5 px-2.5 text-sm text-white/45">
      <Icon name={item.icon} size={18} />
      {item.label} <span className="text-xs">(ปิดชั่วคราว)</span>
    </span>
  )
}
