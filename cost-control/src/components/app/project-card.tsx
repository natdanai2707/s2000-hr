import Link from 'next/link'
import type { ProjectSummary } from '@/lib/types'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDate } from '@/lib/date'
import { cn } from '@/lib/utils'

// สถานะสี: ส่วนต่าง (ต้นทุน% − ความก้าวหน้า%) <= 0 ปกติ, 0 ถึง 5 เฝ้าระวัง, > 5 เตือน
// เฟส 1 ยังไม่มีความก้าวหน้า ใช้ต้นทุน% เทียบ 100% ของงบเป็นหลักชั่วคราว: เกินงบ = เตือน, > 95% = เฝ้าระวัง
export function statusTone(p: ProjectSummary): 'normal' | 'watch' | 'alert' {
  if (p.cost_vs_progress !== null && p.cost_vs_progress !== undefined) {
    const d = toNumber(p.cost_vs_progress)
    if (d <= 0) return 'normal'
    if (d <= 5) return 'watch'
    return 'alert'
  }
  const cost = toNumber(p.cost_pct)
  if (cost > 100 || toNumber(p.forecast_profit) < 0) return 'alert'
  if (cost > 95) return 'watch'
  return 'normal'
}

const toneClass = { normal: 'border-l-status-normal', watch: 'border-l-status-watch', alert: 'border-l-status-alert' }

export function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const tone = statusTone(p)
  const days = p.days_remaining
  return (
    <Link
      href={`/projects/${p.project_id}`}
      className={cn('block rounded-xl border border-border bg-card p-4 border-l-4 hover:bg-muted/40 transition-colors', toneClass[tone])}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{p.code}</div>
          <div className="font-semibold leading-tight truncate">{p.name}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">มูลค่าสัญญา</dt>
          <dd className="tabular font-medium">{formatBaht(p.contract_value)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">ต้นทุน (% ของงบ)</dt>
          <dd className="tabular font-medium">{p.cost_pct === null ? '-' : formatPct(p.cost_pct)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">ความก้าวหน้า</dt>
          <dd className="tabular font-medium">{p.progress_pct === null ? 'ยังไม่เปิดใช้งาน' : formatPct(p.progress_pct)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">ส่วนต่าง (ต้นทุน − ความก้าวหน้า)</dt>
          <dd className="tabular font-medium">{p.cost_vs_progress === null ? '-' : formatPct(p.cost_vs_progress)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">กำไรพยากรณ์ / คาดหวัง</dt>
          <dd className={cn('tabular font-medium', toNumber(p.forecast_profit) < toNumber(p.expected_profit) && 'text-danger-fg')}>
            {formatBaht(p.forecast_profit)} / {formatBaht(p.expected_profit)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">กำหนดเสร็จ</dt>
          <dd className="tabular font-medium">
            {p.planned_end_date ? formatThaiDate(p.planned_end_date) : '-'}
            {days !== null && days !== undefined && (
              <span className={cn('ml-1 text-xs', days < 0 ? 'text-danger-fg' : 'text-muted-foreground')}>
                ({days < 0 ? `เกิน ${Math.abs(days)} วัน` : `เหลือ ${days} วัน`})
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  )
}
