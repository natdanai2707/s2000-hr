import * as React from 'react'
import { cn } from '@/lib/utils'

type Tone = 'info' | 'success' | 'warning' | 'danger'
const tones: Record<Tone, string> = {
  info: 'bg-muted text-foreground border-border',
  success: 'bg-success-bg text-success-fg border-success-bg',
  warning: 'bg-warning-bg text-warning-fg border-warning-bg',
  danger: 'bg-danger-bg text-danger-fg border-danger-bg',
}

export function Alert({ tone = 'info', className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return <div role="alert" className={cn('rounded-lg border px-3 py-2 text-sm', tones[tone], className)} {...props} />
}
