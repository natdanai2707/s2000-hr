import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { formatThaiDate, formatThaiDateTime } from '@/lib/date'

export default async function ApprovalsPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const role = user.profile.role
  const statuses = role === 'management' ? ['pending_pm', 'pending_management'] : role === 'project_manager' ? ['pending_pm'] : []
  const { data: prs } = statuses.length
    ? await supabase
        .from('purchase_requests')
        .select('id, pr_no, status, total_amount, needed_by_date, submitted_at, requires_management, projects(code, name), profiles!purchase_requests_requested_by_fkey(full_name)')
        .in('status', statuses)
        .order('submitted_at', { ascending: true })
    : { data: [] }

  return (
    <div>
      <PageHeader title="รออนุมัติ" subtitle={statuses.length ? `${prs?.length ?? 0} รายการ` : 'บทบาทของคุณไม่มีสิทธิ์อนุมัติ'} />
      {!prs?.length ? (
        <EmptyState title="ไม่มีรายการรออนุมัติ" />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {prs.map(pr => {
            const proj = pr.projects as unknown as { code: string; name: string } | null
            return (
              <Link key={pr.id} href={`/pr/${pr.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="font-medium">{pr.pr_no} <span className="text-muted-foreground font-normal text-sm">· {proj?.name ?? ''}</span></div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(pr.profiles as unknown as { full_name: string } | null)?.full_name ?? ''} · ส่ง {pr.submitted_at ? formatThaiDateTime(pr.submitted_at) : '-'} · ต้องการ {pr.needed_by_date ? formatThaiDate(pr.needed_by_date) : '-'}
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
    </div>
  )
}
