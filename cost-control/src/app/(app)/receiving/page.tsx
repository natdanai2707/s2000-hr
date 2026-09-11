import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { formatThaiDate } from '@/lib/date'

export default async function ReceivingPage() {
  await requireUser()
  const supabase = await createClient()
  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, po_no, status, total_amount, issued_at, projects(code, name), suppliers(name)')
    .in('status', ['issued', 'partially_received'])
    .order('issued_at')
  return (
    <div>
      <PageHeader title="รับของ" subtitle="ใบสั่งซื้อที่ยังรับไม่ครบ" />
      {!pos?.length ? (
        <EmptyState title="ไม่มีใบสั่งซื้อที่รอรับของ" />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {pos.map(po => {
            const proj = po.projects as unknown as { code: string; name: string } | null
            return (
              <Link key={po.id} href={`/receiving/${po.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="font-medium">{po.po_no} <span className="text-muted-foreground font-normal text-sm">· {proj?.name ?? ''}</span></div>
                  <div className="text-xs text-muted-foreground truncate">{(po.suppliers as unknown as { name: string } | null)?.name ?? 'ไม่ระบุซัพพลายเออร์'} · ออก {formatThaiDate(po.issued_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <Money value={po.total_amount} className="block font-medium" />
                  <StatusBadge kind="po" status={po.status} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
