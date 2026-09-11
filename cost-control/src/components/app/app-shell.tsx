'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, type Profile } from '@/lib/types'
import { SIDEBAR_ITEMS, BOTTOM_ITEMS, visibleFor } from './nav-config'
import { createClient } from '@/lib/supabase/client'
import { OfflineSync } from './offline-sync'
import { ServiceWorkerRegister } from './sw-register'

interface Props {
  profile: Profile
  pendingCount: number
  unreadCount: number
  children: ReactNode
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export function AppShell({ profile, pendingCount, unreadCount, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const sidebar = visibleFor(SIDEBAR_ITEMS, profile.role)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const bottomItems = BOTTOM_ITEMS.map(item => ({ ...item, count: item.href === '/approvals' ? pendingCount : 0 }))

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
          {sidebar.map(item => (
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
                'flex flex-col items-center justify-center min-h-14 text-xs',
                isActive(pathname, item.href) ? 'text-primary font-medium' : 'text-muted-foreground'
              )}
            >
              <span>{item.label}</span>
              {item.count > 0 && <span className="text-[11px] text-danger-fg font-medium">{item.count}</span>}
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={cn('flex flex-col items-center justify-center min-h-14 text-xs', moreOpen ? 'text-primary font-medium' : 'text-muted-foreground')}
          >
            เพิ่มเติม
          </button>
        </div>
        {moreOpen && (
          <div className="absolute bottom-full inset-x-0 bg-card border-t border-border max-h-[60vh] overflow-y-auto">
            {sidebar.map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn('block px-5 py-3 text-sm border-b border-border', item.phase && 'text-muted-foreground')}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/notifications" onClick={() => setMoreOpen(false)} className="block px-5 py-3 text-sm border-b border-border">
              แจ้งเตือน
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
