import * as React from 'react'
import { cn } from '@/lib/utils'

type Tone = 'info' | 'success' | 'warning' | 'danger'
const tones: Record<Tone, string> = {
  info: 'bg-muted text-foreground border-l-primary',
  success: 'bg-success-bg text-success-fg border-l-success-fg',
  warning: 'bg-warning-bg text-warning-fg border-l-status-watch',
  danger: 'bg-danger-bg text-danger-fg border-l-danger-fg',
}

export function Alert({ tone = 'info', className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return <div role="alert" className={cn('rounded border-0 border-l-4 px-3 py-2.5 text-sm', tones[tone], className)} {...props} />
}
