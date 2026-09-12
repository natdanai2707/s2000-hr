import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { BoqItemCost, ProjectSummary, Profile } from '@/lib/types'
import { BOQ_VERSION_TYPE_LABELS, ROLE_LABELS } from '@/lib/types'
import { PageHeader, Stat, StatusBadge, Money, EmptyState } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDate, formatThaiDateTime } from '@/lib/date'
import { BoqCostTable } from '@/components/app/boq-cost-table'
import { MembersPanel } from '@/components/app/members-panel'
import { statusTone } from '@/components/app/project-card'
import { cn } from '@/lib/utils'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createClient()

  const { data: summary } = await supabase.from('v_project_summary').select('*').eq('project_id', id).maybeSingle()
  if (!summary) notFound()
  const s = summary as ProjectSummary

  const [{ data: versions }, { data: items }, { data: sections }, { data: pendingPrs }, { data: members }, { data: allProfiles }, { data: branch }] =
    await Promise.all([
      supabase.from('boq_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }),
      s.confirmed_version_id
        ? supabase.from('v_boq_item_costs').select('*').eq('boq_version_id', s.confirmed_version_id)
        : Promise.resolve({ data: [] as BoqItemCost[] }),
      s.confirmed_version_id
        ? supabase.from('boq_sections').select('id, name, sort_order').eq('boq_version_id', s.confirmed_version_id).order('sort_order')
        : Promise.resolve({ data: [] as { id: string; name: string; sort_order: number }[] }),
      supabase
        .from('purchase_requests')
        .select('id, pr_no, status, total_amount, needed_by_date, submitted_at, profiles!purchase_requests_requested_by_fkey(full_name)')
        .eq('project_id', id)
        .in('status', ['pending_pm', 'pending_management'])
        .order('submitted_at', { ascending: true }),
      supabase.from('project_members').select('user_id, role_in_project, profiles(id, full_name, role)').eq('project_id', id),
      supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true).order('full_name'),
      supabase.from('branches').select('name').eq('id', s.branch_id).maybeSingle(),
    ])

  const canManage = user.profile.role === 'management' || user.profile.role === 'admin' || (user.profile.role === 'project_manager' && (members ?? []).some(m => m.user_id === user.id))
  const tone = statusTone(s)
  const toneLabel = { normal: 'ปกติ', watch: 'เฝ้าระวัง', alert: 'เตือน' }[tone]

  return (
    <div>
      <PageHeader
        title={s.name}
        subtitle={`${s.code} · ${branch?.name ?? ''}${s.customer_name ? ` · ${s.customer_name}` : ''}`}
        backHref="/projects"
        actions={
          <>
            {canManage && <Button asChild variant="outline"><Link href={`/projects/${id}/boq/import`}>นำเข้า BOQ</Link></Button>}
            <Button asChild variant="outline"><Link href={`/pr/new?project=${id}`}>ขอซื้อ</Link></Button>
            <Button asChild variant="outline"><Link href={`/expenses/new?project=${id}`}>บันทึกค่าใช้จ่าย</Link></Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge kind="project" status={s.status} />
        <span className={cn('inline-flex items-center gap-1.5 text-xs', tone === 'alert' && 'text-danger-fg', tone === 'watch' && 'text-warning-fg', tone === 'normal' && 'text-success-fg')}>
          <span className={cn('inline-block w-2 h-2 rounded-full', tone === 'alert' && 'bg-status-alert', tone === 'watch' && 'bg-status-watch', tone === 'normal' && 'bg-status-normal')} />
          สถานะ {toneLabel}
        </span>
        <span className="text-muted-foreground">
          {s.start_date ? formatThaiDate(s.start_date) : '-'} ถึง {s.planned_end_date ? formatThaiDate(s.planned_end_date) : '-'}
          {s.days_remaining !== null && ` (${s.days_remaining < 0 ? `เกิน ${Math.abs(s.days_remaining)} วัน` : `เหลือ ${s.days_remaining} วัน`})`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <Stat label="มูลค่าสัญญา" value={formatBaht(s.contract_value)} />
        <Stat label="งบต้นทุน (BOQ)" value={formatBaht(s.total_budget)} sub={`กำไรคาดหวัง ${formatBaht(s.expected_profit)}`} />
        <Stat label="ผูกพันแล้ว (PO ยังไม่รับ)" value={formatBaht(s.committed)} />
        <Stat label="ต้นทุนจริง" value={formatBaht(s.actual)} sub={s.cost_pct === null ? undefined : `${formatPct(s.cost_pct)} ของงบ`} tone={toNumber(s.cost_pct) > 100 ? 'danger' : undefined} />
        <Stat label="ชำระแล้ว" value={formatBaht(s.paid)} />
        <Stat label="ความก้าวหน้า" value={s.progress_pct === null ? 'ยังไม่เปิดใช้งาน' : formatPct(s.progress_pct)} sub="เฟส 2" />
        <Stat label="ส่วนต่าง (ต้นทุน − ความก้าวหน้า)" value={s.cost_vs_progress === null ? '-' : formatPct(s.cost_vs_progress)} sub="เฟส 2" />
        <Stat
          label="กำไรพยากรณ์"
          value={formatBaht(s.forecast_profit)}
          sub={`เทียบคาดหวัง ${formatBaht(toNumber(s.forecast_profit) - toNumber(s.expected_profit))}`}
          tone={toNumber(s.forecast_profit) < toNumber(s.expected_profit) ? 'danger' : 'success'}
        />
      </div>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">BOQ</h2>
        </div>
        {!versions?.length ? (
          <EmptyState title="ยังไม่มี BOQ" hint="นำเข้าไฟล์ .xlsx เพื่อสร้าง BOQ เวอร์ชันแรก" action={canManage ? <Button asChild><Link href={`/projects/${id}/boq/import`}>นำเข้า BOQ</Link></Button> : undefined} />
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {versions.map(v => (
              <Link key={v.id} href={`/projects/${id}/boq/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="font-medium">
                    เวอร์ชัน {v.version_no} · {BOQ_VERSION_TYPE_LABELS[v.type as keyof typeof BOQ_VERSION_TYPE_LABELS]}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {v.confirmed_at ? `ยืนยันเมื่อ ${formatThaiDateTime(v.confirmed_at)}` : `สร้างเมื่อ ${formatThaiDateTime(v.created_at)}`}
                    {v.note ? ` · ${v.note}` : ''}
                  </div>
                </div>
                <StatusBadge kind="boq" status={v.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {s.confirmed_version_id && (
        <section className="mb-6">
          <h2 className="font-semibold mb-2">รายการ BOQ และตัวเลข 4 ชั้น</h2>
          <BoqCostTable items={(items ?? []) as BoqItemCost[]} sections={sections ?? []} />
        </section>
      )}

      <section className="mb-6">
        <h2 className="font-semibold mb-2">ใบขอซื้อรออนุมัติ</h2>
        {!pendingPrs?.length ? (
          <p className="text-sm text-muted-foreground">ไม่มีใบขอซื้อรออนุมัติ</p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {pendingPrs.map(pr => (
              <Link key={pr.id} href={`/pr/${pr.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="font-medium">{pr.pr_no}</div>
                  <div className="text-xs text-muted-foreground">
                    {(pr.profiles as unknown as { full_name: string } | null)?.full_name ?? ''} · ต้องการภายใน {pr.needed_by_date ? formatThaiDate(pr.needed_by_date) : '-'}
                  </div>
                </div>
                <div className="text-right">
                  <Money value={pr.total_amount} className="font-medium block" />
                  <StatusBadge kind="pr" status={pr.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">สมาชิกโครงการ</h2>
        <MembersPanel
          projectId={id}
          canManage={canManage}
          members={(members ?? []).map(m => {
            const p = m.profiles as unknown as Pick<Profile, 'id' | 'full_name' | 'role'> | null
            return { user_id: m.user_id, full_name: p?.full_name ?? '', role: p?.role ?? 'engineer', role_label: ROLE_LABELS[p?.role ?? 'engineer'], role_in_project: m.role_in_project }
          })}
          candidates={(allProfiles ?? []).map(p => ({ id: p.id, full_name: p.full_name, role_label: ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] }))}
        />
      </section>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">ปัญหาที่เปิดอยู่</h2>
        <p className="text-sm text-muted-foreground">ยังไม่เปิดใช้งาน (เฟส 3)</p>
      </section>
    </div>
  )
}
