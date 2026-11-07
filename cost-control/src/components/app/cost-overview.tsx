import Link from 'next/link'
import { PROJECT_STATUS_LABELS, type ProjectSummary } from '@/lib/types'
import { EmptyState, Stat } from './common'
import { ProjectCard } from './project-card'
import { CostMeter } from './cost-meter'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { COST_TONE_LABELS, consumedAmount, consumedPct, costTone, hasBudget, portfolioTotals } from '@/lib/cost'
import { cn } from '@/lib/utils'
import type { CloseoutWarning } from '@/lib/closeout'
import { CloseoutTags } from './closeout-tags'

// ภาพรวมต้นทุนทุกโครงการ: ตัวเลขรวมด้านบน แล้วรายโครงการ (การ์ดบนมือถือ ตารางบนจอใหญ่)
export function CostOverview({ projects, closeout = {} }: { projects: ProjectSummary[]; closeout?: Record<string, CloseoutWarning[]> }) {
  const totals = portfolioTotals(projects)
  const tones = projects.filter(hasBudget).map(costTone)
  const alertCount = tones.filter(t => t === 'alert').length
  const watchCount = tones.filter(t => t === 'watch').length
  const totalTone = totals.consumedPct !== null && totals.consumedPct > 100 ? 'alert' : totals.consumedPct !== null && totals.consumedPct > 95 ? 'watch' : 'normal'
  return (
    <>
      {projects.length === 0 ? (
        <EmptyState title="ยังไม่มีโครงการ" hint="โครงการจะแสดงที่นี่เมื่อ BOQ ได้รับการยืนยัน" />
      ) : (
        <>
          {/* ตัวเลขหลัก: % ใช้ไปตัวใหญ่ แล้วตามด้วยยอดเงิน 4 ช่อง ไม่มีกรอบ ใช้เส้นทึบแบ่ง */}
          <section className="mb-6">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <div>
                <div className="text-sm font-medium text-muted-foreground">ต้นทุนใช้ไปแล้ว รวมทุกโครงการ</div>
                <div className="font-display text-6xl font-bold leading-none tabular mt-1">
                  {totals.consumedPct === null ? '-' : formatPct(totals.consumedPct)}
                </div>
              </div>
              <div className="pb-1 text-sm">
                <span className="text-muted-foreground">ของงบต้นทุน</span>{' '}
                <span className={cn('rounded-sm px-1.5 py-0.5 font-semibold', totalTone === 'alert' ? 'bg-danger-bg text-danger-fg' : totalTone === 'watch' ? 'bg-warning-bg text-warning-fg' : 'bg-success-bg text-success-fg')}>
                  {COST_TONE_LABELS[totalTone]}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <CostMeter pct={totals.consumedPct} tone={totalTone} size="lg" showLabel={false} />
            </div>
            {(alertCount > 0 || watchCount > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {alertCount > 0 && <span className="rounded-sm bg-danger-bg px-1.5 py-0.5 font-semibold text-danger-fg">เตือน {alertCount} โครงการ</span>}
                {watchCount > 0 && <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-semibold text-warning-fg">เฝ้าระวัง {watchCount} โครงการ</span>}
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Stat label="มูลค่าสัญญา" value={formatBaht(totals.contract)} />
              <Stat label="งบต้นทุน" value={formatBaht(totals.budget)} />
              <Stat label="ใช้ไปแล้ว" value={formatBaht(totals.consumed)} />
              <Stat
                label="กำไรพยากรณ์"
                value={formatBaht(totals.forecastProfit)}
                sub={`คาดหวัง ${formatBaht(totals.expectedProfit)}`}
                tone={totals.forecastProfit < totals.expectedProfit ? 'danger' : undefined}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              เงินทั้งหมดไม่รวม VAT ใช้ไปแล้ว = ต้นทุนจริงรวมยอดที่สั่งแล้วแต่ยังไม่รับของ
              {totals.count < projects.length && ` ยอดรวมนับเฉพาะ ${totals.count} โครงการที่ยืนยัน BOQ แล้ว`}
            </p>
          </section>

          <h2 className="mb-2">รายโครงการ</h2>
          {/* มือถือ: การ์ด */}
          <div className="border-t-2 border-foreground md:hidden">
            {projects.map(p => (
              <ProjectCard key={p.project_id} project={p} closeout={closeout[p.project_id]} />
            ))}
          </div>

          {/* จอใหญ่: ตาราง */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-foreground">
                <tr className="border-b-2 border-foreground">
                  <th className="px-4 py-2 text-left font-semibold">โครงการ</th>
                  <th className="px-3 py-2 text-right font-semibold">มูลค่าสัญญา</th>
                  <th className="px-3 py-2 text-right font-semibold">งบต้นทุน</th>
                  <th className="px-3 py-2 text-right font-semibold">ใช้ไปแล้ว</th>
                  <th className="px-3 py-2 text-left font-medium w-48">% ของงบ</th>
                  <th className="px-3 py-2 text-right font-semibold">กำไรคาดหวัง</th>
                  <th className="px-4 py-2 text-right font-semibold">กำไรพยากรณ์</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => {
                  const forecastLow = toNumber(p.forecast_profit) < toNumber(p.expected_profit)
                  return (
                    <tr key={p.project_id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link href={`/projects/${p.project_id}`} className="font-medium hover:underline">{p.name}</Link>
                        <div className="text-xs text-muted-foreground">{p.code} · {PROJECT_STATUS_LABELS[p.status]}</div>
                        {closeout[p.project_id] && <CloseoutTags warnings={closeout[p.project_id]} className="mt-1.5" />}
                      </td>
                      <td className="px-3 py-3 text-right tabular">{formatBaht(p.contract_value)}</td>
                      <td className="px-3 py-3 text-right tabular">{formatBaht(p.total_budget)}</td>
                      <td className="px-3 py-3 text-right tabular">{formatBaht(consumedAmount(p))}</td>
                      <td className="px-3 py-3"><CostMeter pct={consumedPct(p)} tone={costTone(p)} /></td>
                      <td className="px-3 py-3 text-right tabular">{hasBudget(p) ? formatBaht(p.expected_profit) : '-'}</td>
                      <td className={cn('px-4 py-3 text-right tabular', hasBudget(p) && forecastLow && 'text-danger-fg font-medium')}>{hasBudget(p) ? formatBaht(p.forecast_profit) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground font-semibold">
                  <td className="px-4 py-3">รวม {totals.count} โครงการที่มีงบ</td>
                  <td className="px-3 py-3 text-right tabular">{formatBaht(totals.contract)}</td>
                  <td className="px-3 py-3 text-right tabular">{formatBaht(totals.budget)}</td>
                  <td className="px-3 py-3 text-right tabular">{formatBaht(totals.consumed)}</td>
                  <td className="px-3 py-3 tabular">{totals.consumedPct === null ? '-' : formatPct(totals.consumedPct)}</td>
                  <td className="px-3 py-3 text-right tabular">{formatBaht(totals.expectedProfit)}</td>
                  <td className={cn('px-4 py-3 text-right tabular', totals.forecastProfit < totals.expectedProfit && 'text-danger-fg')}>{formatBaht(totals.forecastProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  )
}
