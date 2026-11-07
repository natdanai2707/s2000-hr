import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatThaiDate } from '@/lib/date'
import { CloseoutTags } from '@/components/app/closeout-tags'
import { FINISHED_STATUSES, closeoutWarnings, isFinished, type CloseoutFigures } from '@/lib/closeout'

type Row = { id: string; code: string; name: string; customer_name: string | null; status: string; contract_value: number; planned_end_date: string | null; branches: unknown }

export default async function ProjectsPage() {
  const supabase = await createClient()
  const [user, { data: projects }, { data: recv }] = await Promise.all([
    requireUser(),
    supabase
      .from('projects')
      .select('id, code, name, customer_name, status, contract_value, planned_end_date, branches(name)')
      .order('created_at', { ascending: false }),
    supabase.from('v_project_receivables').select('*').in('status', FINISHED_STATUSES),
  ])
  const figures = new Map(((recv ?? []) as (CloseoutFigures & { project_id: string })[]).map(r => [r.project_id, r]))
  // แยกกลุ่ม: กำลังดำเนินการ (รวมร่าง) แล้วตามด้วยงานเสร็จแล้ว ป้ายเตือนบอกว่ายังขาดส่งงาน วางบิล หรือรับเงิน
  const rows = (projects ?? []) as Row[]
  const groups = [
    { title: 'กำลังดำเนินการ', items: rows.filter(p => !isFinished(p.status)) },
    { title: 'งานเสร็จแล้ว', items: rows.filter(p => isFinished(p.status)) },
  ].filter(g => g.items.length > 0)
  const canCreate = ['management', 'admin', 'project_manager'].includes(user.profile.role)

  return (
    <div>
      <PageHeader title="โครงการ" actions={canCreate ? <Button asChild><Link href="/projects/new">สร้างโครงการ</Link></Button> : undefined} />
      {!projects?.length ? (
        <EmptyState title="ยังไม่มีโครงการ" />
      ) : (
        <div className="space-y-6">
          {groups.map(g => (
            <section key={g.title}>
              <h2 className="mb-2">{g.title} <span className="text-sm font-normal text-muted-foreground">{g.items.length} โครงการ</span></h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map(p => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="min-w-0 rounded-xl border border-border bg-card p-4 hover:bg-muted/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {p.code} · {(p.branches as unknown as { name: string } | null)?.name ?? ''}
                        </div>
                        <div className="font-semibold leading-snug line-clamp-2">{p.name}</div>
                        {p.customer_name && <div className="text-sm text-muted-foreground truncate">{p.customer_name}</div>}
                        {isFinished(p.status) && <CloseoutTags warnings={closeoutWarnings(figures.get(p.id))} className="mt-1.5" />}
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
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
