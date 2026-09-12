import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatThaiDate } from '@/lib/date'

export default async function ProjectsPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name, customer_name, status, contract_value, planned_end_date, branches(name)')
    .order('created_at', { ascending: false })
  const canCreate = ['management', 'admin', 'project_manager'].includes(user.profile.role)

  return (
    <div>
      <PageHeader title="โครงการ" actions={canCreate ? <Button asChild><Link href="/projects/new">สร้างโครงการ</Link></Button> : undefined} />
      {!projects?.length ? (
        <EmptyState title="ยังไม่มีโครงการ" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl border border-border bg-card p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {p.code} · {(p.branches as unknown as { name: string } | null)?.name ?? ''}
                  </div>
                  <div className="font-semibold truncate">{p.name}</div>
                  {p.customer_name && <div className="text-sm text-muted-foreground truncate">{p.customer_name}</div>}
                </div>
                <StatusBadge kind="project" status={p.status} />
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">มูลค่าสัญญา</span>
                <Money value={p.contract_value} className="font-medium" />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">กำหนดเสร็จ</span>
                <span>{p.planned_end_date ? formatThaiDate(p.planned_end_date) : '-'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
