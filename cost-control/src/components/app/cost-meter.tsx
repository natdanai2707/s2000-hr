import { cn } from '@/lib/utils'
import { formatPct } from '@/lib/format'
import { COST_TONE_LABELS, type CostTone } from '@/lib/cost'

const FILL: Record<CostTone, string> = { normal: 'bg-status-normal', watch: 'bg-status-watch', alert: 'bg-status-alert' }
const TRACK: Record<CostTone, string> = { normal: 'bg-success-bg', watch: 'bg-warning-bg', alert: 'bg-danger-bg' }
const LABEL: Record<CostTone, string> = { normal: 'text-success-fg', watch: 'text-warning-fg', alert: 'text-danger-fg' }

// แถบต้นทุนที่ใช้ไปเทียบงบ สีแถบบอกสถานะ และมีคำกำกับสถานะเสมอ ไม่ให้สีเป็นสิ่งเดียวที่บอกความหมาย
export function CostMeter({ pct, tone, size = 'sm', showLabel = true }: { pct: number | null; tone: CostTone; size?: 'sm' | 'lg'; showLabel?: boolean }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">ยังไม่มีงบ</span>
  const width = Math.max(0, Math.min(pct, 100))
  return (
    <div className="w-full" title={`ใช้ไป ${formatPct(pct)} ของงบ · ${COST_TONE_LABELS[tone]}`}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`ต้นทุนใช้ไป ${formatPct(pct)} ของงบ`}
        className={cn('w-full overflow-hidden rounded-full', TRACK[tone], size === 'lg' ? 'h-3' : 'h-2')}
      >
        <div className={cn('h-full rounded-full', FILL[tone])} style={{ width: `${width}%` }} />
      </div>
      {showLabel && (
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="tabular text-foreground">{formatPct(pct)}</span>
          <span className={cn('font-medium', LABEL[tone])}>
            {COST_TONE_LABELS[tone]}
            {pct > 100 && ' · เกินงบ'}
          </span>
        </div>
      )}
    </div>
  )
}
