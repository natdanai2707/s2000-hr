import Link from 'next/link'
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

export function PageHeader({
  title,
  subtitle,
  backHref,
  actions,
}: {
  title: string
  subtitle?: string
  backHref?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="text-xs text-muted-foreground hover:underline">
            ย้อนกลับ
          </Link>
        )}
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  )
}

export function Money({ value, className }: { value: unknown; className?: string }) {
  return <span className={cn('tabular', className)}>{formatBaht(value)}</span>
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular mt-0.5', tone === 'danger' && 'text-danger-fg', tone === 'success' && 'text-success-fg', tone === 'warning' && 'text-warning-fg')}>
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
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
