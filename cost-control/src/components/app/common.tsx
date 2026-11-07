import Link from 'next/link'
import { HeaderMore } from './header-more'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatBaht } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  PR_STATUS_LABELS,
  PO_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  BOQ_VERSION_STATUS_LABELS,
} from '@/lib/types'

// actions = ปุ่มหลักที่เห็นเสมอ, more = ปุ่มรองที่บนมือถือพับไว้ใต้ เพิ่มเติม
export function PageHeader({
  title,
  subtitle,
  backHref,
  actions,
  more,
}: {
  title: string
  subtitle?: string
  backHref?: string
  actions?: ReactNode
  more?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b-2 border-foreground pb-3">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="mb-1 inline-flex h-8 items-center text-sm font-medium text-primary hover:underline">
            ‹ ย้อนกลับ
          </Link>
        )}
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {(actions || more) && (
        <div className="flex w-full flex-wrap gap-2 no-print md:w-auto [&>a]:flex-1 [&>button]:flex-1 md:[&>a]:flex-none md:[&>button]:flex-none">
          {actions}
          {more && <HeaderMore>{more}</HeaderMore>}
        </div>
      )}
    </div>
  )
}

export function Money({ value, className }: { value: unknown; className?: string }) {
  return <span className={cn('tabular', className)}>{formatBaht(value)}</span>
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="border-y border-border px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

// ตัวเลขหลักของหน้า: เส้นทึบด้านบน ชื่อเล็ก ตัวเลขใหญ่ฟอนต์หัวข้อ ไม่ใส่กรอบ สีเฉพาะค่าที่ต้องจัดการ
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className="border-t-2 border-foreground pt-2 pb-1">
      <div className="text-[13px] font-medium text-muted-foreground leading-snug">{label}</div>
      <div
        className={cn(
          'font-display text-[22px] font-bold leading-tight tabular mt-0.5 break-words',
          tone === 'danger' && 'text-danger-fg',
          tone === 'success' && 'text-success-fg',
          tone === 'warning' && 'text-warning-fg'
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

type Variant = 'success' | 'warning' | 'danger' | 'neutral' | 'default'
const prVariant: Record<string, Variant> = {
  draft: 'neutral', pending_pm: 'warning', pending_management: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral',
}
const poVariant: Record<string, Variant> = { issued: 'default', partially_received: 'warning', received: 'success', cancelled: 'neutral' }
const invVariant: Record<string, Variant> = { received: 'warning', approved: 'default', paid: 'success' }
const projVariant: Record<string, Variant> = { draft: 'neutral', active: 'success', closing: 'warning', closed: 'neutral' }
const boqVariant: Record<string, Variant> = { draft: 'neutral', confirmed: 'success', superseded: 'neutral' }

export function StatusBadge({ kind, status }: { kind: 'pr' | 'po' | 'invoice' | 'project' | 'boq'; status: string }) {
  const table = { pr: [PR_STATUS_LABELS, prVariant], po: [PO_STATUS_LABELS, poVariant], invoice: [INVOICE_STATUS_LABELS, invVariant], project: [PROJECT_STATUS_LABELS, projVariant], boq: [BOQ_VERSION_STATUS_LABELS, boqVariant] } as const
  const [labels, variants] = table[kind]
  const label = (labels as Record<string, string>)[status] ?? status
  return <Badge variant={variants[status] ?? 'neutral'}>{label}</Badge>
}

export function FormField({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-danger-fg">{error}</p>}
    </div>
  )
}
