import Link from 'next/link'
import { PROJECT_STATUS_LABELS, type ProjectSummary } from '@/lib/types'
import { EmptyState } from './common'
import { ProjectCard } from './project-card'
import { CostMeter } from './cost-meter'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { COST_TONE_LABELS, consumedAmount, consumedPct, costTone, hasBudget, portfolioTotals } from '@/lib/cost'
import { cn } from '@/lib/utils'

// ภาพรวมต้นทุนทุกโครงการ: ตัวเลขรวมด้านบน แล้วรายโครงการ (การ์ดบนมือถือ ตารางบนจอใหญ่)
export function CostOverview({ projects }: { projects: ProjectSummary[] }) {
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
          <section className="mb-4 rounded-xl border border-border bg-card p-4 md:p-5">
            <div className="text-sm text-muted-foreground">ต้นทุนใช้ไปแล้วรวมทุกโครงการ</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-5xl font-semibold leading-tight">{totals.consumedPct === null ? '-' : formatPct(totals.consumedPct)}</span>
              <span className="text-sm text-muted-foreground">ของงบต้นทุน</span>
              <span className={cn('text-sm font-medium', totalTone === 'alert' ? 'text-danger-fg' : totalTone === 'watch' ? 'text-warning-fg' : 'text-success-fg')}>
                {COST_TONE_LABELS[totalTone]}
              </span>
            </div>
            <div className="mt-3">
              <CostMeter pct={totals.consumedPct} tone={totalTone} size="lg" showLabel={false} />
            </div>
            {(alertCount > 0 || watchCount > 0) && (
              <p className="mt-2 text-sm">
                {alertCount > 0 && <span className="font-medium text-danger-fg">เตือน {alertCount} โครงการ</span>}
                {alertCount > 0 && watchCount > 0 && <span className="text-muted-foreground"> · </span>}
                {watchCount > 0 && <span className="font-medium text-warning-fg">เฝ้าระวัง {watchCount} โครงการ</span>}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5 text-sm">
              <Tile label="มูลค่าสัญญา" value={totals.contract} />
              <Tile label="งบต้นทุน" value={totals.budget} />
              <Tile label="ใช้ไปแล้ว" value={totals.consumed} />
              <Tile label="กำไรคาดหวัง" value={totals.expectedProfit} />
              <Tile label="กำไรพยากรณ์" value={totals.forecastProfit} danger={totals.forecastProfit < totals.expectedProfit} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              ตัวเลขเงินทั้งหมดไม่รวม VAT ใช้ไปแล้ว = ต้นทุนจริง รวมยอดที่สั่งแล้วแต่ยังไม่รับของ
              {totals.count < projects.length && ` · ยอดรวมนับเฉพาะ ${totals.count} โครงการที่ยืนยัน BOQ แล้ว`}
            </p>
          </section>

          {/* มือถือ: การ์ด */}
          <div className="grid gap-3 md:hidden">
            {projects.map(p => (
              <ProjectCard key={p.project_id} project={p} />
            ))}
          </div>

          {/* จอใหญ่: ตาราง */}
          <div className="hidden md:block rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">โครงการ</th>
                  <th className="px-3 py-2 text-right font-medium">มูลค่าสัญญา</th>
                  <th className="px-3 py-2 text-right font-medium">งบต้นทุน</th>
                  <th className="px-3 py-2 text-right font-medium">ใช้ไปแล้ว</th>
                  <th className="px-3 py-2 text-left font-medium w-48">% ของงบ</th>
                  <th className="px-3 py-2 text-right font-medium">กำไรคาดหวัง</th>
                  <th className="px-4 py-2 text-right font-medium">กำไรพยากรณ์</th>
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
                <tr className="border-t-2 border-border font-semibold">
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

function Tile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-semibold', danger && 'text-danger-fg')}>{formatBaht(value)}</dd>
    </div>
  )
}
