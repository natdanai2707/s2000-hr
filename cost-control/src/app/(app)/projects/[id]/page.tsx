import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser, loadSettings } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { BoqItemCost, ProjectSummary, Profile } from '@/lib/types'
import { BOQ_VERSION_TYPE_LABELS, ROLE_LABELS, usesDirectPurchase } from '@/lib/types'
import { Stat, StatusBadge, Money, EmptyState } from '@/components/app/common'
import { HeaderMore } from '@/components/app/header-more'
import { Button } from '@/components/ui/button'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDate, formatThaiDateTime } from '@/lib/date'
import { BoqCostTable } from '@/components/app/boq-cost-table'
import { MembersPanel } from '@/components/app/members-panel'
import { COST_TONE_LABELS, consumedAmount, consumedPct, costTone, hasBudget } from '@/lib/cost'
import { DeleteProjectButton } from '@/components/app/delete-project-button'
import { FinishProjectButton } from '@/components/app/finish-project-button'
import { EditBoqButton } from '@/components/app/edit-boq-button'
import { CloseoutTags } from '@/components/app/closeout-tags'
import { Meter, projectFlags } from '@/components/app/cost-overview'
import { Icon } from '@/components/app/icons'
import { closeoutWarnings, isFinished } from '@/lib/closeout'
import { cn } from '@/lib/utils'

const TABS = ['overview', 'boq', 'buy', 'income', 'team'] as const
type Tab = (typeof TABS)[number]

const TONE_TEXT = { normal: 'text-success-fg', watch: 'text-warning-fg', alert: 'text-danger-fg' }
const TONE_CHIP = { normal: 'bg-success-bg text-success-fg', watch: 'bg-warning-bg text-warning-fg', alert: 'bg-danger-bg text-danger-fg' }

// หน้าโครงการแบ่งเป็นแท็บ โหลดข้อมูลเฉพาะแท็บที่เปิด หน้าแรกบอกสุขภาพต้นทุนเป็นประโยค แล้วตามด้วยเรื่องที่ต้องทำ
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'overview'
  const supabase = await createClient()
  // ข้อมูลที่ไม่ขึ้นต่อกันถามพร้อมกัน ลดจำนวนรอบที่ต้องรอฐานข้อมูล
  const [user, settings, { data: summary }, { data: receivable }, { data: members }, { count: prCount }] = await Promise.all([
    requireUser(),
    loadSettings(),
    supabase.from('v_project_summary').select('*').eq('project_id', id).maybeSingle(),
    supabase.from('v_project_receivables').select('*').eq('project_id', id).maybeSingle(),
    supabase.from('project_members').select('user_id, role_in_project, profiles(id, full_name, role)').eq('project_id', id),
    supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('project_id', id).neq('status', 'cancelled'),
  ])
  if (!summary) notFound()
  const s = summary as ProjectSummary
  const direct = usesDirectPurchase(settings, user.profile.role)
  const needItems = (tab === 'overview' || tab === 'boq') && !!s.confirmed_version_id

  const [{ data: branch }, { data: versions }, { data: items }, { data: sections }, { data: prs }, { data: allProfiles }] = await Promise.all([
    supabase.from('branches').select('name').eq('id', s.branch_id).maybeSingle(),
    tab === 'boq' ? supabase.from('boq_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }) : Promise.resolve({ data: null }),
    needItems ? supabase.from('v_boq_item_costs').select('*').eq('boq_version_id', s.confirmed_version_id!) : Promise.resolve({ data: [] as BoqItemCost[] }),
    needItems
      ? supabase.from('boq_sections').select('id, name, sort_order').eq('boq_version_id', s.confirmed_version_id!).order('sort_order')
      : Promise.resolve({ data: [] as { id: string; name: string; sort_order: number }[] }),
    tab === 'overview' || tab === 'buy'
      ? supabase
          .from('purchase_requests')
          .select('id, pr_no, status, total_amount, submitted_at, created_at, profiles!purchase_requests_requested_by_fkey(full_name), purchase_request_items(supplier_name)')
          .eq('project_id', id)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(tab === 'overview' ? 3 : 100)
      : Promise.resolve({ data: null }),
    tab === 'team' ? supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true).order('full_name') : Promise.resolve({ data: null }),
  ])

  const role = user.profile.role
  const financeRole = ['accounting', 'management', 'admin'].includes(role)
  const isBoss = role === 'management' || role === 'admin'
  const canManage = isBoss || (role === 'project_manager' && (members ?? []).some(m => m.user_id === user.id))
  const tone = costTone(s)
  const pct = consumedPct(s)
  const budgeted = hasBudget(s)
  const finished = isFinished(s.status)
  const handoverDate = (receivable?.handover_date as string | null | undefined) ?? null
  const warnings = closeoutWarnings(receivable ? { ...receivable, handover_date: handoverDate } : null)
  // เกินงบและกำไรติดลบบอกไว้ในกล่องต้นทุนแล้ว ที่นี่เหลือเรื่องอื่น เช่น เลยกำหนด
  const flags = projectFlags(s, undefined).filter(f => !f.text.startsWith('ยังไม่มี BOQ') && !f.text.startsWith('เกินงบ') && !f.text.startsWith('กำไรพยากรณ์'))

  const finishButton = (
    <FinishProjectButton
      projectId={id}
      status={s.status}
      actualEndDate={s.actual_end_date}
      handoverDate={handoverDate}
      warnings={warnings}
      contract={toNumber(s.contract_value)}
      actualCost={toNumber(s.actual)}
      variant={finished ? 'default' : 'outline'}
    />
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'ภาพรวม' },
    { key: 'boq', label: 'BOQ' },
    { key: 'buy', label: `สั่งซื้อ${prCount ? ` ${prCount}` : ''}` },
    { key: 'income', label: 'รายรับ' },
    { key: 'team', label: `ทีม ${(members ?? []).length}` },
  ]
  const href = (t: Tab) => (t === 'overview' ? `/projects/${id}` : `/projects/${id}?tab=${t}`)

  return (
    <div>
      {/* หัวโครงการ: ป้ายสถานะ ชื่อ ลูกค้า วันที่ ปุ่มหลัก แล้วแท็บ ติดขอบจอบนมือถือ */}
      <section className="-mx-4 -mt-4 mb-4 border-b border-border bg-card px-4 pt-3 md:mx-0 md:mt-0 md:rounded-md md:border md:px-5 md:pt-4">
        <Link href="/projects" className="inline-flex h-8 items-center gap-1 text-sm font-medium text-primary hover:underline">
          <Icon name="chevronLeft" size={16} /> โครงการทั้งหมด
        </Link>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <StatusBadge kind="project" status={s.status} />
          {budgeted && <span className={cn('rounded-sm px-1.5 py-0.5 text-xs font-bold', TONE_CHIP[tone])}>ต้นทุน{COST_TONE_LABELS[tone]}</span>}
        </div>
        <h1 className="mt-1.5 font-display text-[22px] font-bold leading-snug md:text-[26px]">{s.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {s.code}{s.customer_name ? ` · ${s.customer_name}` : ''}{branch?.name ? ` · สาขา${branch.name}` : ''}
        </p>
        <p className="text-sm text-muted-foreground">
          {s.start_date ? formatThaiDate(s.start_date) : '-'} ถึง {s.planned_end_date ? formatThaiDate(s.planned_end_date) : '-'}
          {s.actual_end_date ? (
            <> · เสร็จจริง {formatThaiDate(s.actual_end_date)}{lateDays(s.planned_end_date, s.actual_end_date)}</>
          ) : (
            s.days_remaining !== null && (
              <> · <b className={cn('font-semibold', s.days_remaining < 0 ? 'text-danger-fg' : 'text-foreground')}>{s.days_remaining < 0 ? `เกินกำหนด ${Math.abs(s.days_remaining)} วัน` : `เหลือ ${s.days_remaining} วัน`}</b></>
            )
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-2 no-print [&>a]:flex-1 md:[&>a]:flex-none">
          <Button asChild>
            <Link href={`/pr/new?project=${id}`}>
              <Icon name="camera" size={20} /> {direct ? 'บันทึกการสั่งซื้อ' : 'ขอซื้อ'}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/expenses/new?project=${id}`}>ค่าใช้จ่าย</Link>
          </Button>
          <HeaderMore>
            {canManage && s.confirmed_version_id && <EditBoqButton projectId={id} confirmedVersionId={isBoss ? s.confirmed_version_id : null} />}
            {canManage && <Button asChild variant="outline"><Link href={`/projects/${id}/boq/import`}>นำเข้า BOQ</Link></Button>}
            {canManage && !finished && finishButton}
            {canManage && <Button asChild variant="outline"><Link href={`/projects/${id}/edit`}>แก้ไขโครงการ</Link></Button>}
            {isBoss && <DeleteProjectButton projectId={id} projectCode={s.code} />}
          </HeaderMore>
        </div>

        <nav aria-label="ส่วนของโครงการ" className="-mx-4 mt-3 flex overflow-x-auto px-2 md:-mx-5 md:px-3">
          {tabs.map(t => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={t.key === tab ? 'page' : undefined}
              className={cn('flex h-12 shrink-0 items-center border-b-[3px] px-3 text-[15px]', t.key === tab ? 'border-primary font-bold text-primary' : 'border-transparent font-medium text-foreground/75 hover:text-foreground')}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </section>

      {finished && tab === 'overview' && (
        <section className="mb-4 rounded-md border border-border border-l-4 border-l-primary bg-card px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="font-display text-lg font-bold">{s.status === 'closed' ? 'ปิดโครงการแล้ว' : 'งานเสร็จแล้ว'}</div>
              <div className="text-sm text-muted-foreground">
                เสร็จหน้างาน {s.actual_end_date ? formatThaiDate(s.actual_end_date) : '-'}
                {' · '}
                {handoverDate ? `ส่งงาน ${formatThaiDate(handoverDate)}` : 'ยังไม่ส่งงาน'}
              </div>
              <CloseoutTags warnings={warnings} billingHref={financeRole ? `/billing?project=${id}` : undefined} />
            </div>
            {canManage && <div className="shrink-0">{finishButton}</div>}
          </div>
        </section>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <section aria-labelledby="health-h" className="space-y-2.5 rounded-md border border-border bg-card p-3.5 md:p-5">
            <h2 id="health-h" className="text-sm font-semibold text-muted-foreground">ต้นทุนใช้ไปแล้วเทียบงบ</h2>
            {budgeted ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn('font-display text-[40px] font-bold leading-none tabular', tone !== 'normal' && TONE_TEXT[tone])}>{pct === null ? '-' : formatPct(pct)}</span>
                  <span className="text-sm text-muted-foreground">ของงบ {formatBaht(s.total_budget)}</span>
                </div>
                <Meter pct={pct} tone={tone} className="h-2.5" />
                <HealthSentence s={s} />
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[15px]">ยังไม่มี BOQ ยืนยัน นำเข้า BOQ เพื่อเริ่มคุมต้นทุนของงานนี้</p>
                {canManage && <Button asChild><Link href={`/projects/${id}/boq/import`}>นำเข้า BOQ</Link></Button>}
              </div>
            )}
          </section>

          <section aria-label="ตัวเลขหลัก" className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Card label="มูลค่าสัญญา" value={formatBaht(s.contract_value)} sub="ไม่รวม VAT" />
            <Card label="ต้นทุนจริง" value={formatBaht(s.actual)} sub={`ชำระแล้ว ${formatBaht(s.paid)}`} />
            <Card label="สั่งแล้วยังไม่รับของ" value={formatBaht(s.committed)} sub={budgeted ? `งบต้นทุน ${formatBaht(s.total_budget)}` : undefined} />
            <Card
              label="กำไรพยากรณ์"
              value={budgeted ? formatBaht(s.forecast_profit) : '-'}
              sub={budgeted ? `คาดหวัง ${formatBaht(s.expected_profit)}` : undefined}
              danger={budgeted && toNumber(s.forecast_profit) < toNumber(s.expected_profit)}
            />
            {s.progress_pct !== null && <Card label="ความก้าวหน้า" value={formatPct(s.progress_pct)} />}
          </section>

          {flags.length > 0 && (
            <section aria-labelledby="todo-h" className="space-y-2">
              <h2 id="todo-h" className="font-display text-lg font-bold">ต้องจัดการในงานนี้</h2>
              <div className="divide-y divide-border rounded-md border border-border bg-card">
                {flags.map(f => (
                  <div key={f.text} className="flex min-h-14 items-center gap-2.5 px-3 py-2.5 text-[15px]">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', f.tone === 'danger' ? 'bg-status-alert' : 'bg-status-watch')} />
                    {f.text}
                  </div>
                ))}
              </div>
            </section>
          )}

          {budgeted && <TopSections items={(items ?? []) as BoqItemCost[]} sections={sections ?? []} boqHref={href('boq')} />}

          <section aria-labelledby="buy-h" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 id="buy-h" className="font-display text-lg font-bold">สั่งซื้อล่าสุด</h2>
              {!!prCount && <Link href={href('buy')} className="flex min-h-11 items-center text-sm font-semibold text-primary">ดูทั้งหมด {prCount}</Link>}
            </div>
            <PrRows prs={(prs ?? []) as unknown as PrRow[]} empty={direct ? 'ยังไม่มีรายการสั่งซื้อ' : 'ยังไม่มีใบขอซื้อ'} />
          </section>
        </div>
      )}

      {tab === 'boq' && (
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">เวอร์ชัน BOQ</h2>
              {canManage && <Link href={`/projects/${id}/boq/import`} className="flex min-h-11 items-center text-sm font-semibold text-primary">นำเข้า BOQ</Link>}
            </div>
            {!versions?.length ? (
              <EmptyState title="ยังไม่มี BOQ" hint="นำเข้าไฟล์ .xlsx เพื่อสร้าง BOQ เวอร์ชันแรก" action={canManage ? <Button asChild><Link href={`/projects/${id}/boq/import`}>นำเข้า BOQ</Link></Button> : undefined} />
            ) : (
              <div className="divide-y divide-border rounded-md border border-border bg-card">
                {versions.map(v => (
                  <Link key={v.id} href={`/projects/${id}/boq/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="font-medium">เวอร์ชัน {v.version_no} · {BOQ_VERSION_TYPE_LABELS[v.type as keyof typeof BOQ_VERSION_TYPE_LABELS]}</div>
                      <div className="truncate text-xs text-muted-foreground">
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
            <section className="space-y-2">
              <h2 className="font-display text-lg font-bold">รายการ BOQ และตัวเลข 4 ชั้น</h2>
              <BoqCostTable items={(items ?? []) as BoqItemCost[]} sections={sections ?? []} />
            </section>
          )}
        </div>
      )}

      {tab === 'buy' && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">{direct ? 'รายการสั่งซื้อ' : 'ใบขอซื้อ'}</h2>
          <PrRows prs={(prs ?? []) as unknown as PrRow[]} empty={direct ? 'ยังไม่มีรายการสั่งซื้อ' : 'ยังไม่มีใบขอซื้อ'} />
        </section>
      )}

      {tab === 'income' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">รายรับ</h2>
            {financeRole && <Link href={`/billing?filter=all&project=${id}`} className="flex min-h-11 items-center text-sm font-semibold text-primary">วางบิลและรับเงิน</Link>}
          </div>
          {receivable ? (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-4">
              <Stat
                label="วางบิลแล้ว (ไม่รวม VAT)"
                value={formatBaht(receivable.billed_excl_vat)}
                sub={receivable.billed_pct === null ? undefined : `${formatPct(toNumber(receivable.billed_pct))} ของมูลค่าสัญญา`}
              />
              <Stat label="เงินเข้าจริง" value={formatBaht(receivable.cash_received)} sub={`ต้นทุนจริง ${formatBaht(s.actual)}`} />
              <Stat label="ค้างรับ (รวม VAT)" value={formatBaht(receivable.outstanding)} tone={toNumber(receivable.outstanding) > 0 ? 'warning' : undefined} />
              <Stat label="เงินประกันผลงานที่ลูกค้าถือไว้" value={formatBaht(receivable.retention_held)} />
            </div>
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลรายรับ" />
          )}
          {finished && <CloseoutTags warnings={warnings} billingHref={financeRole ? `/billing?project=${id}` : undefined} />}
        </section>
      )}

      {tab === 'team' && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">สมาชิกโครงการ</h2>
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
      )}
    </div>
  )
}

function Card({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card p-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn('break-words font-display text-xl font-bold tabular', danger && 'text-danger-fg')}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

// สุขภาพต้นทุนเป็นประโยคเดียว อ่านแล้วรู้เลยว่าต้องระวังอะไร
function HealthSentence({ s }: { s: ProjectSummary }) {
  const budget = toNumber(s.total_budget)
  const used = consumedAmount(s)
  const committed = toNumber(s.committed)
  if (used > budget) {
    return <p className="rounded bg-danger-bg px-2.5 py-2 text-sm text-danger-fg">ใช้เกินงบแล้ว {formatBaht(used - budget)}{committed > 0 ? ` รวมที่สั่งแล้วยังไม่รับของ ${formatBaht(committed)}` : ''}</p>
  }
  if (toNumber(s.forecast_profit) < 0) {
    return <p className="rounded bg-danger-bg px-2.5 py-2 text-sm text-danger-fg">กำไรพยากรณ์ติดลบ {formatBaht(s.forecast_profit)} ตรวจราคาที่สั่งซื้อเทียบ BOQ</p>
  }
  const tone = costTone(s)
  return (
    <p className={cn('rounded px-2.5 py-2 text-sm', tone === 'watch' ? 'bg-warning-bg text-warning-fg' : 'bg-canvas text-foreground')}>
      เหลืองบ {formatBaht(budget - used)}{committed > 0 ? ` นับรวมที่สั่งแล้วยังไม่รับของ ${formatBaht(committed)} แล้ว` : ''}
    </p>
  )
}

// 3 หมวดที่ใช้งบไปมากที่สุด
function TopSections({ items, sections, boqHref }: { items: BoqItemCost[]; sections: { id: string; name: string }[]; boqHref: string }) {
  const groups = new Map<string, { name: string; budget: number; used: number }>()
  for (const it of items) {
    const key = it.section_id ?? 'none'
    const g = groups.get(key) ?? { name: sections.find(x => x.id === it.section_id)?.name ?? 'ไม่ระบุหมวด', budget: 0, used: 0 }
    g.budget += toNumber(it.budget)
    g.used += toNumber(it.actual) + toNumber(it.committed)
    groups.set(key, g)
  }
  const top = [...groups.values()]
    .filter(g => g.budget > 0)
    .map(g => ({ ...g, pct: (g.used / g.budget) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
  if (top.length === 0) return null
  return (
    <section aria-labelledby="sec-h" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id="sec-h" className="font-display text-lg font-bold">หมวดที่ใช้งบมากสุด</h2>
        <Link href={boqHref} className="flex min-h-11 items-center text-sm font-semibold text-primary">BOQ ทั้งหมด</Link>
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-card px-3">
        {top.map(g => {
          const tone = g.pct > 100 ? 'alert' : g.pct > 95 ? 'watch' : 'normal'
          return (
            <div key={g.name} className="space-y-1.5 py-2.5">
              <div className="flex justify-between gap-2 text-[15px]">
                <span className="font-semibold">{g.name}</span>
                <span className={cn('font-bold tabular', tone !== 'normal' && TONE_TEXT[tone])}>{formatPct(g.pct)}</span>
              </div>
              <Meter pct={g.pct} tone={tone} />
              <div className="text-xs text-muted-foreground">ใช้ {formatBaht(g.used)} จากงบ {formatBaht(g.budget)}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

type PrRow = {
  id: string
  pr_no: string
  status: string
  total_amount: number
  submitted_at: string | null
  created_at: string
  profiles: { full_name: string } | null
  purchase_request_items: { supplier_name: string | null }[] | null
}

function PrRows({ prs, empty }: { prs: PrRow[]; empty: string }) {
  if (!prs.length) return <p className="rounded-md border border-border bg-card px-4 py-4 text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {prs.map(pr => {
        const supplier = pr.purchase_request_items?.find(i => i.supplier_name)?.supplier_name ?? null
        return (
          <Link key={pr.id} href={`/pr/${pr.id}`} className="flex min-h-[60px] items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{supplier ?? pr.pr_no}</div>
              <div className="text-[13px] text-muted-foreground">
                {supplier ? `${pr.pr_no} · ` : ''}
                {formatThaiDate(pr.submitted_at ?? pr.created_at)}
                {pr.profiles?.full_name ? ` · ${pr.profiles.full_name}` : ''}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <Money value={pr.total_amount} className="block text-[15px] font-bold" />
              <StatusBadge kind="pr" status={pr.status} />
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// เทียบวันที่เสร็จจริงกับกำหนดเสร็จ
function lateDays(planned: string | null, actual: string): string {
  if (!planned) return ''
  const d = Math.round((Date.parse(actual) - Date.parse(planned)) / 86400000)
  return d > 0 ? ` (ช้ากว่ากำหนด ${d} วัน)` : d < 0 ? ` (เร็วกว่ากำหนด ${-d} วัน)` : ' (ตามกำหนด)'
}
