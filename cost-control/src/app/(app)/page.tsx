import Link from 'next/link'
import { requireUser, loadSettings } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { usesDirectPurchase, type ProjectSummary } from '@/lib/types'
import { Alert } from '@/components/ui/alert'
import { Icon, type IconName } from '@/components/app/icons'
import { QuickActions, TodoPanel, PortfolioSummary, ProjectList } from '@/components/app/cost-overview'
import { consumedPct } from '@/lib/cost'
import { cn } from '@/lib/utils'
import { closeoutWarnings, isFinished, type CloseoutFigures, type CloseoutWarning } from '@/lib/closeout'
import { loadTodos } from '@/lib/todos'
import { toNumber } from '@/lib/format'

const FILTERS = [
  { key: 'active', label: 'กำลังทำ', match: (s: string) => s === 'active' || s === 'draft' },
  { key: 'finished', label: 'เสร็จแล้ว', match: (s: string) => isFinished(s) },
  { key: 'all', label: 'ทั้งหมด', match: () => true },
]

const DAY = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })

type Recv = CloseoutFigures & { project_id: string; code: string; status: string; outstanding: number }

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string; q?: string }> }) {
  const { error, show, q } = await searchParams
  const filter = FILTERS.find(f => f.key === show) ?? FILTERS[0]
  const supabase = await createClient()

  const [user, settings, { data }, { data: recv }] = await Promise.all([
    requireUser(),
    loadSettings(),
    supabase.from('v_project_summary').select('*'),
    supabase.from('v_project_receivables').select('*'),
  ])
  const role = user.profile.role
  const direct = usesDirectPurchase(settings, role)
  const all = (data ?? []) as ProjectSummary[]
  const receivables = (recv ?? []) as Recv[]

  const closeout: Record<string, CloseoutWarning[]> = {}
  for (const r of receivables) if (isFinished(r.status)) closeout[r.project_id] = closeoutWarnings(r)

  const term = (q ?? '').trim().toLowerCase()
  const shown = all
    .filter(p => filter.match(p.status))
    .filter(p => !term || [p.code, p.name, p.customer_name ?? ''].some(v => v.toLowerCase().includes(term)))
    // โครงการที่ใช้ต้นทุนไปมากที่สุดเทียบงบขึ้นก่อน โครงการที่ยังไม่มีงบอยู่ท้าย
    .sort((a, b) => (consumedPct(b) ?? -1) - (consumedPct(a) ?? -1))
  const counts = Object.fromEntries(FILTERS.map(f => [f.key, all.filter(p => f.match(p.status)).length]))

  const finance = ['accounting', 'management', 'admin'].includes(role)
  const todos = await loadTodos(supabase, { role, direct, projects: all, receivables })
  const shownIds = new Set(shown.map(p => p.project_id))
  const outstanding = finance ? receivables.filter(r => shownIds.has(r.project_id)).reduce((n, r) => n + toNumber(r.outstanding), 0) : null

  const canCreate = ['management', 'admin', 'project_manager'].includes(role)
  const firstName = user.profile.full_name.split(/\s+/)[0]
  const quick: { href: string; label: string; icon: IconName; hint?: string; primary?: boolean }[] = [
    { href: '/pr/new', label: direct ? 'บันทึกการสั่งซื้อ' : 'ขอซื้อ', icon: 'camera', hint: direct ? 'ถ่ายรูป PO แนบได้หลายใบ ระบบอ่านให้' : 'ส่งใบขอซื้อให้อนุมัติ', primary: true },
    ...(canCreate ? [{ href: '/projects/new', label: 'เปิดงานใหม่', icon: 'plus' as IconName }] : []),
    { href: '/expenses/new', label: 'บันทึกค่าใช้จ่าย', icon: 'receipt' },
    ...(finance ? [{ href: '/billing', label: 'วางบิลและรับเงิน', icon: 'bill' as IconName }] : []),
    { href: '/pr', label: direct ? 'รายการซื้อ' : 'ใบขอซื้อ', icon: 'list' },
  ]

  const filterHref = (key: string) => {
    const sp = new URLSearchParams()
    if (key !== 'active') sp.set('show', key)
    if (q) sp.set('q', q)
    const s = sp.toString()
    return s ? `/?${s}` : '/'
  }

  return (
    <div className="space-y-5 md:space-y-6">
      {error === 'forbidden' && <Alert tone="danger">คุณไม่มีสิทธิ์เข้าถึงหน้าที่ร้องขอ</Alert>}

      {/* มือถือ: ทักทายก่อน จอใหญ่: หัวหน้าพร้อมปุ่มหลัก */}
      <div className="md:hidden">
        <div className="text-sm text-muted-foreground">{DAY.format(new Date())}</div>
        <h1 className="font-display text-[26px] font-bold leading-tight">สวัสดี คุณ{firstName}</h1>
      </div>
      <div className="hidden flex-wrap items-end justify-between gap-3 border-b-2 border-foreground pb-3.5 md:flex">
        <div>
          <h1 className="font-display text-[30px] font-bold leading-tight">{direct ? 'ภาพรวมต้นทุน' : 'แดชบอร์ด'}</h1>
          <p className="text-sm text-muted-foreground">{role === 'management' || role === 'admin' ? 'ทุกโครงการทุกสาขา' : 'โครงการที่คุณเป็นสมาชิก'} · {DAY.format(new Date())}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <Link href="/projects/new" className="inline-flex h-11 items-center gap-2 rounded border border-input bg-card px-4 text-[15px] font-semibold hover:bg-muted">
              <Icon name="plus" size={18} /> เปิดงานใหม่
            </Link>
          )}
          {finance && (
            <Link href="/billing" className="inline-flex h-11 items-center gap-2 rounded border border-input bg-card px-4 text-[15px] font-semibold hover:bg-muted">
              <Icon name="bill" size={18} /> วางบิลและรับเงิน
            </Link>
          )}
        </div>
      </div>

      <QuickActions actions={quick} />
      <TodoPanel todos={todos} />
      {shown.length > 0 && <PortfolioSummary projects={shown} outstanding={outstanding} />}

      <section id="projects" aria-labelledby="proj-h" className="space-y-2.5 scroll-mt-16">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="proj-h" className="font-display text-lg font-bold md:text-xl">โครงการ</h2>
          <form action="/" className="order-last w-full md:order-none md:w-auto">
            {show && <input type="hidden" name="show" value={show} />}
            <label className="relative block">
              <span className="sr-only">ค้นหาโครงการ</span>
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="ค้นหารหัส ชื่องาน ลูกค้า"
                className="h-11 w-full rounded border border-input bg-card pl-9 pr-3 text-[15px] md:w-64"
              />
            </label>
          </form>
        </div>
        <nav aria-label="กรองโครงการ" className="grid grid-cols-3 gap-[3px] rounded-md bg-border p-[3px] md:inline-grid md:w-auto">
          {FILTERS.map(f => (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              aria-current={f.key === filter.key ? 'page' : undefined}
              className={cn('flex h-10 items-center justify-center rounded px-3 text-sm', f.key === filter.key ? 'bg-card font-bold shadow-sm' : 'font-semibold text-foreground/75 hover:text-foreground')}
            >
              {f.label}{f.key !== 'all' ? ` ${counts[f.key]}` : ''}
            </Link>
          ))}
        </nav>
        <ProjectList projects={shown} closeout={closeout} />
      </section>
    </div>
  )
}
