import Link from 'next/link'
import type { CloseoutWarning } from '@/lib/closeout'
import { cn } from '@/lib/utils'

// ป้ายเตือนของงานที่เสร็จแล้ว: ยังไม่ส่งงาน ยังไม่วางบิล ยังไม่รับเงิน ค้างรับ เงินประกันรอคืน
// billingHref ใส่เมื่ออยากให้ป้ายเรื่องเงินกดไปหน้าวางบิลได้ (ห้ามใส่เมื่ออยู่ในลิงก์อื่นอยู่แล้ว)
export function CloseoutTags({ warnings, billingHref, className }: { warnings: CloseoutWarning[]; billingHref?: string; className?: string }) {
  const chip = 'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold'
  if (warnings.length === 0) {
    return (
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        <span className={cn(chip, 'bg-success-bg text-success-fg')}>✓ ส่งงาน วางบิล รับเงินครบ</span>
      </div>
    )
  }
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {warnings.map(w =>
        billingHref && w.target === 'billing' ? (
          <Link key={w.key} href={billingHref} className={cn(chip, 'bg-warning-bg text-warning-fg underline-offset-2 hover:underline')}>
            ! {w.label}
          </Link>
        ) : (
          <span key={w.key} className={cn(chip, 'bg-warning-bg text-warning-fg')}>! {w.label}</span>
        )
      )}
    </div>
  )
}
