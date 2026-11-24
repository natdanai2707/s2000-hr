import Link from 'next/link'
import type { ProjectSummary } from '@/lib/types'
import type { Todo } from '@/lib/todos'
import type { CloseoutWarning } from '@/lib/closeout'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDate } from '@/lib/date'
import { COST_TONE_LABELS, consumedAmount, consumedPct, costTone, hasBudget, portfolioTotals, type CostTone } from '@/lib/cost'
import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icons'
import { CloseoutTags } from './closeout-tags'

const TONE_TEXT: Record<CostTone, string> = { normal: 'text-success-fg', watch: 'text-warning-fg', alert: 'text-danger-fg' }
const TONE_BAR: Record<CostTone, string> = { normal: 'bg-status-normal', watch: 'bg-status-watch', alert: 'bg-status-alert' }
const TONE_EDGE: Record<CostTone, string> = { normal: 'border-l-status-normal', watch: 'border-l-status-watch', alert: 'border-l-status-alert' }
const TONE_CHIP: Record<CostTone, string> = { normal: 'bg-success-bg text-success-fg', watch: 'bg-warning-bg text-warning-fg', alert: 'bg-danger-bg text-danger-fg' }

export function Meter({ pct, tone, className }: { pct: number | null; tone: CostTone; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-border', className)} role="img" aria-label={pct === null ? 'ยังไม่มีงบ' : `ใช้ไป ${formatPct(pct)} ของงบ`}>
      <div className={cn('h-full', TONE_BAR[tone])} style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%` }} />
    </div>
  )
}

// ปุ่มลัดบนมือถือ ปุ่มบันทึกการสั่งซื้อใหญ่สุดเพราะใช้บ่อยสุด
export function QuickActions({ actions }: { actions: { href: string; label: string; icon: IconName; hint?: string; primary?: boolean }[] }) {
  return (
    <section aria-label="ทำรายการด่วน" className="grid grid-cols-2 gap-2 md:hidden">
      {actions.map(a =>
        a.primary ? (
          <Link key={a.href} href={a.href} className="col-span-2 flex min-h-16 items-center gap-3 rounded-md bg-primary px-4 py-3 text-primary-foreground">
            <Icon name={a.icon} size={28} />
            <span className="flex flex-col">
              <span className="text-[17px] font-bold">{a.label}</span>
              {a.hint && <span className="text-[13px] text-white/85">{a.hint}</span>}
            </span>
          </Link>
        ) : (
          <Link key={a.href} href={a.href} className="flex min-h-14 items-center gap-2.5 rounded-md border border-input/60 bg-card px-3 py-2.5 text-[15px] font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-brand-tint text-primary">
              <Icon name={a.icon} size={18} strokeWidth={2.2} />
            </span>
            {a.label}
          </Link>
        )
      )}
    </section>
  )
}

// ต้องจัดการ: มือถือเป็นรายการเรียงลงในการ์ดเดียว จอใหญ่เป็นการ์ดเรียงแถว ตัวเลขใหญ่
export function TodoPanel({ todos }: { todos: Todo[] }) {
  return (
    <section aria-labelledby="todo-h" className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 id="todo-h" className="font-display text-lg font-bold md:text-xl">ต้องจัดการ</h2>
        <span className="text-[13px] text-muted-foreground">{todos.length ? `${todos.length} เรื่อง` : ''}</span>
      </div>
      {todos.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-4 text-[15px]">
          <Icon name="check" size={20} className="text-success-fg" strokeWidth={2.4} />
          ไม่มีเรื่องค้าง
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card divide-y divide-border md:grid md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] md:gap-3 md:divide-y-0 md:overflow-visible md:border-0 md:bg-transparent">
          {todos.map(t => (
            <Link
              key={t.key}
              href={t.href}
              className={cn(
                'flex min-h-[60px] items-center gap-3 px-3 py-2.5 hover:bg-muted/40',
                'md:min-h-[116px] md:flex-col md:items-start md:gap-1 md:rounded-md md:border md:border-border md:border-t-4 md:bg-card md:p-3.5',
                t.tone === 'danger' ? 'md:border-t-status-alert' : 'md:border-t-status-watch'
              )}
            >
              <span
                className={cn(
                  'flex h-7 min-w-9 items-center justify-center rounded px-1.5 text-[15px] font-bold',
                  'md:h-auto md:min-w-0 md:bg-transparent md:px-0 md:font-display md:text-[30px] md:leading-tight',
                  t.tone === 'danger' ? 'bg-danger-bg text-danger-fg' : 'bg-warning-bg text-warning-fg md:text-status-watch'
                )}
              >
                {t.count}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold leading-snug">{t.title}</span>
                <span className="text-[13px] text-muted-foreground">{t.detail}</span>
              </span>
              <Icon name="chevronRight" size={20} className="text-muted-foreground md:hidden" />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

// ตัวเลขรวมทุกงานที่แสดงอยู่: % ใช้ไปตัวใหญ่ แถบ แล้วตามด้วยยอดเงิน
export function PortfolioSummary({ projects, outstanding }: { projects: ProjectSummary[]; outstanding: number | null }) {
  const t = portfolioTotals(projects)
  const tone: CostTone = (t.consumedPct !== null && t.consumedPct > 100) || (t.count > 0 && t.forecastProfit < 0) ? 'alert' : t.consumedPct !== null && t.consumedPct > 95 ? 'watch' : 'normal'
  const m = (n: number) => `${(n / 1_000_000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ล้าน`
  const cells = [
    { label: 'มูลค่าสัญญา', value: m(t.contract), full: formatBaht(t.contract) },
    { label: 'ใช้ไปแล้ว', value: m(t.consumed), full: formatBaht(t.consumed) },
    { label: 'กำไรพยากรณ์', value: m(t.forecastProfit), full: formatBaht(t.forecastProfit), danger: t.forecastProfit < t.expectedProfit, sub: `คาดหวัง ${formatBaht(t.expectedProfit)}` },
    ...(outstanding !== null ? [{ label: 'ค้างรับจากลูกค้า', value: m(outstanding), full: formatBaht(outstanding), warn: outstanding > 0, sub: 'รวม VAT' }] : []),
  ]
  return (
    <section aria-labelledby="cost-h" className="rounded-md border border-border bg-card p-3.5 md:grid md:grid-cols-[minmax(220px,1.2fr)_repeat(auto-fit,minmax(140px,1fr))] md:items-start md:gap-5 md:p-5">
      <div className="space-y-2">
        <h2 id="cost-h" className="text-sm font-semibold text-muted-foreground">ต้นทุนใช้ไปแล้วเทียบงบ</h2>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[40px] font-bold leading-none tabular">{t.consumedPct === null ? '-' : formatPct(t.consumedPct)}</span>
          <span className={cn('ml-auto rounded px-2 py-0.5 text-[13px] font-bold md:ml-1', TONE_CHIP[tone])}>{COST_TONE_LABELS[tone]}</span>
        </div>
        <Meter pct={t.consumedPct} tone={tone} className="h-2.5" />
        {t.count < projects.length && <p className="text-xs text-muted-foreground">นับเฉพาะ {t.count} โครงการที่ยืนยัน BOQ แล้ว</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 md:contents">
        {cells.map((c, i) => (
          <div key={c.label} className={cn('flex flex-col', i === 3 && 'hidden md:flex')}>
            <span className="text-xs text-muted-foreground">{c.label}</span>
            <span title={c.full} className={cn('text-[15px] font-bold tabular md:font-display md:text-2xl', 'danger' in c && c.danger && 'text-danger-fg', 'warn' in c && c.warn && 'text-warning-fg')}>
              <span className="md:hidden">{c.value}</span>
              <span className="hidden md:inline">{c.full}</span>
            </span>
            {'sub' in c && c.sub && <span className="hidden text-xs text-muted-foreground md:block">{c.sub}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}

export interface ProjectFlag {
  text: string
  tone: 'warning' | 'danger'
}

// ต้องตามต่อของแต่ละโครงการ: เกินงบ เลยกำหนด หรือเรื่องค้างหลังงานเสร็จ
export function projectFlags(p: ProjectSummary, closeout: CloseoutWarning[] | undefined): ProjectFlag[] {
  const flags: ProjectFlag[] = []
  const budget = toNumber(p.total_budget)
  const used = consumedAmount(p)
  if (hasBudget(p) && used > budget) flags.push({ text: `เกินงบ ${formatBaht(used - budget)}`, tone: 'danger' })
  else if (hasBudget(p) && toNumber(p.forecast_profit) < 0) flags.push({ text: 'กำไรพยากรณ์ติดลบ', tone: 'danger' })
  if (p.status === 'active' && !p.actual_end_date && p.days_remaining !== null && p.days_remaining < 0) flags.push({ text: `เลยกำหนด ${Math.abs(p.days_remaining)} วัน`, tone: 'warning' })
  if (!hasBudget(p)) flags.push({ text: 'ยังไม่มี BOQ ยืนยัน', tone: 'warning' })
  for (const w of closeout ?? []) flags.push({ text: w.label, tone: w.target === 'billing' ? 'danger' : 'warning' })
  return flags
}

function dueText(p: ProjectSummary): string {
  if (p.actual_end_date) return `เสร็จ ${formatThaiDate(p.actual_end_date)}`
  if (p.days_remaining === null || p.days_remaining === undefined) return p.planned_end_date ? `กำหนดเสร็จ ${formatThaiDate(p.planned_end_date)}` : 'ยังไม่กำหนดวันเสร็จ'
  return p.days_remaining < 0 ? `เกินกำหนด ${Math.abs(p.days_remaining)} วัน` : `เหลือ ${p.days_remaining} วัน`
}

// รายการโครงการ: มือถือเป็นการ์ดสั้น จอใหญ่เป็นตาราง มีคอลัมน์ต้องตามต่อ
export function ProjectList({ projects, closeout }: { projects: ProjectSummary[]; closeout: Record<string, CloseoutWarning[]> }) {
  if (projects.length === 0) {
    return <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-[15px] text-muted-foreground">ไม่พบโครงการ</div>
  }
  return (
    <>
      <div className="space-y-2 md:hidden">
        {projects.map(p => {
          const tone = costTone(p)
          const pct = consumedPct(p)
          const low = hasBudget(p) && toNumber(p.forecast_profit) < toNumber(p.expected_profit)
          return (
            <Link key={p.project_id} href={`/projects/${p.project_id}`} className={cn('block space-y-2 rounded-md border border-l-4 border-border bg-card p-3', hasBudget(p) ? TONE_EDGE[tone] : 'border-l-input')}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">{p.code}{p.customer_name ? ` · ${p.customer_name}` : ''}</div>
                  <div className="text-base font-bold leading-snug">{p.name}</div>
                </div>
                {hasBudget(p) && <span className={cn('whitespace-nowrap text-xs font-bold', TONE_TEXT[tone])}>{COST_TONE_LABELS[tone]}</span>}
              </div>
              {closeout[p.project_id] && <CloseoutTags warnings={closeout[p.project_id]} />}
              {hasBudget(p) ? (
                <div className="flex items-center gap-2.5">
                  <Meter pct={pct} tone={tone} className="flex-1" />
                  <span className="w-14 text-right text-[15px] font-bold tabular">{pct === null ? '-' : formatPct(pct)}</span>
                </div>
              ) : (
                <div className="text-[13px] text-muted-foreground">ยังไม่มี BOQ ยืนยัน</div>
              )}
              <div className="flex justify-between gap-2 text-[13px] text-muted-foreground">
                <span>{dueText(p)}</span>
                {hasBudget(p) && <span>กำไรพยากรณ์ <b className={cn('tabular', low ? 'text-danger-fg' : 'text-foreground')}>{formatBaht(p.forecast_profit)}</b></span>}
              </div>
            </Link>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-border bg-card md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-canvas text-left">
              <th className="px-4 py-2.5 font-bold">โครงการ</th>
              <th className="px-3 py-2.5 text-right font-bold">มูลค่าสัญญา</th>
              <th className="px-3 py-2.5 text-right font-bold">งบต้นทุน</th>
              <th className="w-52 px-3 py-2.5 font-bold">ใช้ไปแล้ว</th>
              <th className="px-3 py-2.5 text-right font-bold">กำไรพยากรณ์</th>
              <th className="px-4 py-2.5 font-bold">ต้องตามต่อ</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => {
              const tone = costTone(p)
              const pct = consumedPct(p)
              const flags = projectFlags(p, closeout[p.project_id])
              const low = hasBudget(p) && toNumber(p.forecast_profit) < toNumber(p.expected_profit)
              return (
                <tr key={p.project_id} className="border-t border-border hover:bg-muted/40">
                  <td className={cn('border-l-4 px-4 py-3', hasBudget(p) ? TONE_EDGE[tone] : 'border-l-input')}>
                    <Link href={`/projects/${p.project_id}`} className="font-bold hover:underline">{p.name}</Link>
                    <div className="text-xs text-muted-foreground">{p.code}{p.customer_name ? ` · ${p.customer_name}` : ''} · {dueText(p)}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular">{formatBaht(p.contract_value)}</td>
                  <td className="px-3 py-3 text-right tabular">{hasBudget(p) ? formatBaht(p.total_budget) : '-'}</td>
                  <td className="px-3 py-3">
                    {hasBudget(p) ? (
                      <div className="flex items-center gap-2">
                        <Meter pct={pct} tone={tone} className="flex-1" />
                        <span className={cn('w-14 text-right font-bold tabular', tone !== 'normal' && TONE_TEXT[tone])}>{pct === null ? '-' : formatPct(pct)}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className={cn('px-3 py-3 text-right font-bold tabular', low && 'text-danger-fg')}>{hasBudget(p) ? formatBaht(p.forecast_profit) : '-'}</td>
                  <td className="px-4 py-3">
                    {flags.length === 0 ? (
                      <span className="text-xs text-muted-foreground">ไม่มี</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {flags.slice(0, 2).map(f => (
                          <span key={f.text} className={cn('rounded-sm px-1.5 py-0.5 text-xs font-bold', f.tone === 'danger' ? 'bg-danger-bg text-danger-fg' : 'bg-warning-bg text-warning-fg')}>{f.text}</span>
                        ))}
                        {flags.length > 2 && <span className="text-xs text-muted-foreground">+{flags.length - 2}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

