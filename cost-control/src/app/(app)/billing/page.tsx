import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, Stat } from '@/components/app/common'
import { BillingDialog, ReceiptDialog, VoidBillingButton, DeleteReceiptButton, type BillingProject, type BillingRow, type ReceiptRow } from '@/components/app/billing-dialogs'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDate, todayISO, daysBetween } from '@/lib/date'
import { cn } from '@/lib/utils'

// วางบิลลูกค้าและเงินเข้าจริง งานของฝ่ายบัญชี ฝ่ายบริหารและผู้ดูแลระบบทำแทนได้
const FILTERS = [
  { key: 'open', label: 'ค้างรับ' },
  { key: 'all', label: 'ทั้งหมด' },
] as const

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ filter?: string; project?: string }> }) {
  const user = await requireUser()
  const { filter = 'open', project } = await searchParams
  const canEdit = ['accounting', 'management', 'admin'].includes(user.profile.role)
  const supabase = await createClient()

  let billQ = supabase.from('v_customer_billing_status').select('*').order('billed_date', { ascending: false }).limit(500)
  let recQ = supabase.from('customer_receipts').select('*').order('received_date', { ascending: false }).limit(1000)
  let sumQ = supabase.from('v_project_receivables').select('*').order('code')
  if (project) {
    billQ = billQ.eq('project_id', project)
    recQ = recQ.eq('project_id', project)
    sumQ = sumQ.eq('project_id', project)
  }
  const [{ data: bills }, { data: receipts }, { data: sums }, { data: projectRows }] = await Promise.all([
    billQ,
    recQ,
    sumQ,
    supabase.from('projects').select('id, code, name, contract_value, retention_pct, status').in('status', ['active', 'closing', 'draft']).order('code'),
  ])

  const projects: BillingProject[] = (projectRows ?? []).map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
    contract_value: toNumber(p.contract_value),
    retention_pct: toNumber(p.retention_pct),
  }))
  const projectOf = (id: string) => projects.find(p => p.id === id) ?? (sums ?? []).map(s => ({ id: s.project_id, code: s.code, name: s.name, contract_value: toNumber(s.contract_value), retention_pct: 0 })).find(p => p.id === id)
  const today = todayISO()
  const shown = (bills ?? []).filter(b => (filter === 'all' ? true : !b.voided_at && toNumber(b.outstanding) > 0.005))
  const activeSums = (sums ?? []).filter(s => toNumber(s.billed_total) > 0 || toNumber(s.cash_received) > 0)
  const total = activeSums.reduce(
    (a, s) => ({ outstanding: a.outstanding + toNumber(s.outstanding), cash: a.cash + toNumber(s.cash_received), retention: a.retention + toNumber(s.retention_held) }),
    { outstanding: 0, cash: 0, retention: 0 }
  )
  const overdue = (bills ?? []).filter(b => !b.voided_at && toNumber(b.outstanding) > 0.005 && b.due_date && daysBetween(today, b.due_date) < 0)
  const unlinked = (receipts ?? []).filter(r => !r.billing_id)
  const selected = project ? projectOf(project) : null

  const toBilling = (b: Record<string, unknown>): BillingRow => ({
    id: b.billing_id as string,
    project_id: b.project_id as string,
    billing_no: b.billing_no as string,
    installment: (b.installment as string | null) ?? null,
    billed_date: b.billed_date as string,
    due_date: (b.due_date as string | null) ?? null,
    amount: toNumber(b.amount),
    vat_amount: toNumber(b.vat_amount),
    note: (b.note as string | null) ?? null,
    outstanding: toNumber(b.outstanding),
  })
  const toReceipt = (r: Record<string, unknown>): ReceiptRow => ({
    id: r.id as string,
    received_date: r.received_date as string,
    amount_received: toNumber(r.amount_received),
    withholding_tax: toNumber(r.withholding_tax),
    retention: toNumber(r.retention),
    other_deduction: toNumber(r.other_deduction),
    is_retention_release: !!r.is_retention_release,
    note: (r.note as string | null) ?? null,
  })
  const qs = (f: string) => `/billing?filter=${f}${project ? `&project=${project}` : ''}`

  return (
    <div>
      <PageHeader
        title="วางบิลและรับเงิน"
        subtitle={selected ? `${selected.code} ${selected.name}` : 'ยอดที่เรียกเก็บลูกค้าและเงินเข้าจริงของทุกโครงการ'}
        backHref={project ? `/projects/${project}` : undefined}
        actions={
          canEdit ? (
            <>
              <ReceiptDialog projects={projects} />
              <BillingDialog projects={projects} defaultProjectId={project} />
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <Stat label="ค้างรับ (รวม VAT)" value={formatBaht(total.outstanding)} tone={total.outstanding > 0 ? 'warning' : undefined} />
        <Stat label="เกินกำหนด" value={`${overdue.length} ใบ`} sub={overdue.length ? formatBaht(overdue.reduce((a, b) => a + toNumber(b.outstanding), 0)) : undefined} tone={overdue.length ? 'danger' : undefined} />
        <Stat label="เงินเข้าจริงแล้ว" value={formatBaht(total.cash)} />
        <Stat label="เงินประกันผลงานที่ลูกค้าถือไว้" value={formatBaht(total.retention)} />
      </div>

      {activeSums.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold mb-2">แยกตามโครงการ</h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {activeSums.map(s => (
              <Link key={s.project_id} href={`/billing?filter=all&project=${s.project_id}`} className="block px-4 py-3 hover:bg-muted/40">
                <div className="flex justify-between gap-3 text-sm">
                  <div className="min-w-0 font-medium truncate">{s.code} {s.name}</div>
                  <div className="shrink-0 tabular">{s.billed_pct === null ? '-' : formatPct(toNumber(s.billed_pct))} ของสัญญา</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular">
                  สัญญา {formatBaht(s.contract_value)} · วางบิลแล้ว {formatBaht(s.billed_excl_vat)} (ไม่รวม VAT) · เงินเข้า {formatBaht(s.cash_received)}
                  {toNumber(s.outstanding) > 0 && <span className="text-warning-fg"> · ค้างรับ {formatBaht(s.outstanding)}</span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map(f => (
          <Link key={f.key} href={qs(f.key)} className={cn('rounded-full border px-3 py-1', f.key === filter ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card')}>
            {f.label}
          </Link>
        ))}
        {project && <Link href={`/billing?filter=${filter}`} className="text-xs underline">ดูทุกโครงการ</Link>}
      </div>

      {!shown.length ? (
        <EmptyState title={filter === 'all' ? 'ยังไม่มีการวางบิล' : 'ไม่มีบิลค้างรับ'} hint={canEdit ? 'กดบันทึกการวางบิลเมื่อส่งบิลให้ลูกค้า' : undefined} />
      ) : (
        <div className="space-y-2 mb-6">
          {shown.map(b => {
            const row = toBilling(b)
            const proj = projectOf(row.project_id)
            const total = row.amount + row.vat_amount
            const dueDays = row.due_date ? daysBetween(today, row.due_date) : null
            const voided = !!b.voided_at
            const paidOff = !voided && row.outstanding <= 0.005
            const recs = (receipts ?? []).filter(r => r.billing_id === row.id)
            return (
              <div key={row.id} className={cn('rounded-xl border border-border bg-card p-4 text-sm', voided && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {row.billing_no}
                      {row.installment && <span className="font-normal"> · {row.installment}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {proj ? `${proj.code} ${proj.name}` : ''} · วางบิล {formatThaiDate(row.billed_date)}
                      {row.due_date && (
                        <span className={cn(!paidOff && !voided && dueDays !== null && dueDays < 0 && 'text-danger-fg font-medium')}>
                          {' '}· ครบกำหนด {formatThaiDate(row.due_date)}
                          {!paidOff && !voided && dueDays !== null && dueDays < 0 && ` (เกิน ${Math.abs(dueDays)} วัน)`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular">
                    <div className="font-medium">{formatBaht(total)}</div>
                    <div className="text-xs text-muted-foreground">ไม่รวม VAT {formatBaht(row.amount)}</div>
                    <div className={cn('text-xs font-medium', voided ? 'text-muted-foreground' : paidOff ? 'text-success-fg' : 'text-warning-fg')}>
                      {voided ? 'ยกเลิกแล้ว' : paidOff ? 'รับครบแล้ว' : `ค้างรับ ${formatBaht(row.outstanding)}`}
                    </div>
                  </div>
                </div>
                {voided && b.void_reason && <div className="mt-1 text-xs text-muted-foreground">เหตุผลที่ยกเลิก: {b.void_reason as string}</div>}
                {row.note && <div className="mt-1 text-xs text-muted-foreground">{row.note}</div>}

                {recs.length > 0 && (
                  <div className="mt-3 border-t border-border pt-2 space-y-1">
                    {recs.map(r => (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="tabular">
                          {formatThaiDate(r.received_date)} · เงินเข้า {formatBaht(r.amount_received)}
                          {toNumber(r.withholding_tax) > 0 && ` · หัก ณ ที่จ่าย ${formatBaht(r.withholding_tax)}`}
                          {toNumber(r.retention) > 0 && ` · ประกันผลงาน ${formatBaht(r.retention)}`}
                          {toNumber(r.other_deduction) > 0 && ` · หักอื่น ${formatBaht(r.other_deduction)}`}
                          {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1">
                            <ReceiptDialog billing={row} receipt={toReceipt(r)} />
                            <DeleteReceiptButton id={r.id} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && !voided && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {!paidOff && <ReceiptDialog billing={row} retentionPct={projects.find(p => p.id === row.project_id)?.retention_pct ?? 0} />}
                    <BillingDialog projects={projects} billing={row} />
                    {recs.length === 0 && <VoidBillingButton id={row.id} billingNo={row.billing_no} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {unlinked.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">เงินเข้าที่ไม่ผูกบิล</h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border text-sm">
            {unlinked.map(r => {
              const proj = projectOf(r.project_id)
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="tabular">{formatThaiDate(r.received_date)} · {formatBaht(r.amount_received)}{r.is_retention_release && ' · คืนเงินประกันผลงาน'}</div>
                    <div className="text-xs text-muted-foreground truncate">{proj ? `${proj.code} ${proj.name}` : ''}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <ReceiptDialog receipt={toReceipt(r)} />
                      <DeleteReceiptButton id={r.id} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
