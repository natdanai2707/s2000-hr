import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatThaiDate } from '@/lib/date'
import { PR_STATUS_LABELS, type PrStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const FILTERS: { key: string; label: string; statuses: PrStatus[] }[] = [
  { key: 'all', label: 'ทั้งหมด', statuses: [] },
  { key: 'pending', label: 'รออนุมัติ', statuses: ['pending_pm', 'pending_management'] },
  { key: 'approved', label: 'อนุมัติแล้ว', statuses: ['approved'] },
  { key: 'rejected', label: 'ไม่อนุมัติ', statuses: ['rejected', 'cancelled'] },
]

export default async function PrListPage({ searchParams }: { searchParams: Promise<{ filter?: string; mine?: string }> }) {
  const user = await requireUser()
  const { filter = 'all', mine } = await searchParams
  const supabase = await createClient()
  const f = FILTERS.find(x => x.key === filter) ?? FILTERS[0]
  let q = supabase
    .from('purchase_requests')
    .select('id, pr_no, status, total_amount, needed_by_date, submitted_at, created_at, requested_by, projects(code, name), profiles!purchase_requests_requested_by_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (f.statuses.length) q = q.in('status', f.statuses)
  if (mine === '1') q = q.eq('requested_by', user.id)
  const { data: prs } = await q

  return (
    <div>
      <PageHeader title="ใบขอซื้อ" actions={<Button asChild><Link href="/pr/new">สร้างใบขอซื้อ</Link></Button>} />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(x => (
          <Link key={x.key} href={`/pr?filter=${x.key}${mine === '1' ? '&mine=1' : ''}`} className={cn('rounded-full border px-3 py-1', x.key === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card')}>
            {x.label}
          </Link>
        ))}
        <Link href={`/pr?filter=${f.key}${mine === '1' ? '' : '&mine=1'}`} className={cn('rounded-full border px-3 py-1', mine === '1' ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card')}>
          ของฉัน
        </Link>
      </div>
      {!prs?.length ? (
        <EmptyState title="ไม่มีใบขอซื้อ" action={<Button asChild><Link href="/pr/new">สร้างใบขอซื้อ</Link></Button>} />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {prs.map(pr => {
            const proj = pr.projects as unknown as { code: string; name: string } | null
            const by = pr.profiles as unknown as { full_name: string } | null
            return (
              <Link key={pr.id} href={`/pr/${pr.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="font-medium">{pr.pr_no} <span className="text-muted-foreground font-normal text-sm">· {proj?.name ?? ''}</span></div>
                  <div className="text-xs text-muted-foreground truncate">
                    {by?.full_name ?? ''} · สร้าง {formatThaiDate(pr.created_at)} · ต้องการ {pr.needed_by_date ? formatThaiDate(pr.needed_by_date) : '-'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <Money value={pr.total_amount} className="block font-medium" />
                  <StatusBadge kind="pr" status={pr.status} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">สถานะ: {Object.values(PR_STATUS_LABELS).join(' / ')}</p>
    </div>
  )
}
