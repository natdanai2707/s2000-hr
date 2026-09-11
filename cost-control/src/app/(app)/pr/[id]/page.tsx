import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatBaht, formatQty } from '@/lib/format'
import { formatThaiDate, formatThaiDateTime } from '@/lib/date'
import { PrDecision } from '@/components/app/pr-decision'

export default async function PrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createClient()
  const { data: pr } = await supabase
    .from('purchase_requests')
    .select('*, projects(id, code, name), profiles!purchase_requests_requested_by_fkey(full_name)')
    .eq('id', id)
    .maybeSingle()
  if (!pr) notFound()
  const [{ data: items }, { data: approvals }, { data: members }, { data: po }] = await Promise.all([
    supabase.from('purchase_request_items').select('*, boq_items(item_no, description, unit, qty, unit_cost, is_off_boq)').eq('pr_id', id).order('created_at'),
    supabase.from('approvals').select('*, profiles!approvals_approver_id_fkey(full_name)').eq('document_type', 'purchase_request').eq('document_id', id).order('decided_at'),
    supabase.from('project_members').select('user_id').eq('project_id', pr.project_id),
    supabase.from('purchase_orders').select('id, po_no, status').eq('pr_id', id).neq('status', 'cancelled').maybeSingle(),
  ])
  const proj = pr.projects as unknown as { id: string; code: string; name: string }
  const isMember = (members ?? []).some(m => m.user_id === user.id)
  const role = user.profile.role
  const canDecide =
    (pr.status === 'pending_pm' && (role === 'management' || (role === 'project_manager' && isMember))) ||
    (pr.status === 'pending_management' && role === 'management')
  const canCancel = pr.requested_by === user.id && ['draft', 'pending_pm', 'pending_management', 'rejected'].includes(pr.status)
  const canCreatePo = pr.status === 'approved' && !po && (role === 'purchasing' || role === 'management')

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={pr.pr_no}
        subtitle={`${proj.code} ${proj.name}`}
        backHref="/pr"
        actions={canCreatePo ? <Button asChild><Link href={`/po/new?pr=${id}`}>ออกใบสั่งซื้อ</Link></Button> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge kind="pr" status={pr.status} />
        {pr.requires_management && <span className="text-xs text-muted-foreground">ต้องผ่านฝ่ายบริหาร</span>}
        {po && <Link href={`/po/${po.id}`} className="text-xs underline">ใบสั่งซื้อ {po.po_no}</Link>}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm grid grid-cols-2 gap-3 mb-4">
        <div><div className="text-xs text-muted-foreground">ผู้ขอ</div><div>{(pr.profiles as unknown as { full_name: string } | null)?.full_name ?? ''}</div></div>
        <div><div className="text-xs text-muted-foreground">ส่งเมื่อ</div><div>{pr.submitted_at ? formatThaiDateTime(pr.submitted_at) : '-'}</div></div>
        <div><div className="text-xs text-muted-foreground">วันที่ต้องการ</div><div>{pr.needed_by_date ? formatThaiDate(pr.needed_by_date) : '-'}</div></div>
        <div><div className="text-xs text-muted-foreground">มูลค่ารวม</div><Money value={pr.total_amount} className="font-semibold" /></div>
        {pr.note && <div className="col-span-2"><div className="text-xs text-muted-foreground">หมายเหตุ</div><div>{pr.note}</div></div>}
      </div>

      <h2 className="font-semibold mb-2">รายการ</h2>
      <div className="space-y-2 mb-4">
        {(items ?? []).map(it => {
          const b = it.boq_items as unknown as { item_no: string | null; description: string; unit: string | null; qty: number; unit_cost: number; is_off_boq: boolean } | null
          return (
            <div key={it.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="font-medium">{b?.item_no ? `${b.item_no} ` : ''}{it.description}</div>
              <div className="text-xs text-muted-foreground">
                BOQ: {b?.is_off_boq ? 'นอก BOQ' : `${formatQty(b?.qty)} ${b?.unit ?? ''} ที่ ${formatBaht(b?.unit_cost)}`}
                {it.supplier_name ? ` · ${it.supplier_name}` : ''}
              </div>
              <div className="mt-1 flex justify-between">
                <span className="tabular">{formatQty(it.qty)} {it.unit ?? ''} × {formatBaht(it.unit_price)}</span>
                <span className="tabular font-medium">{formatBaht(Number(it.qty) * Number(it.unit_price))}</span>
              </div>
              {(it.qty_over_boq || it.price_over_threshold || b?.is_off_boq) && (
                <div className="mt-1 text-xs">
                  {it.qty_over_boq && <span className="text-danger-fg mr-2">เกินปริมาณ BOQ</span>}
                  {it.price_over_threshold && <span className="text-danger-fg mr-2">เกินราคาที่ทดไว้</span>}
                  {it.variance_reason && <span className="text-muted-foreground">เหตุผล: {it.variance_reason}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <h2 className="font-semibold mb-2">ประวัติการอนุมัติ</h2>
      {!approvals?.length ? (
        <p className="text-sm text-muted-foreground mb-4">ยังไม่มีการตัดสินใจ</p>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border mb-4 text-sm">
          {approvals.map(a => (
            <div key={a.id} className="px-4 py-2.5">
              <div className="flex justify-between">
                <span>{a.step === 'pm' ? 'ผู้จัดการโครงการ' : 'ฝ่ายบริหาร'}: {(a.profiles as unknown as { full_name: string } | null)?.full_name ?? ''}</span>
                <span className={a.decision === 'approved' ? 'text-success-fg' : 'text-danger-fg'}>{a.decision === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}</span>
              </div>
              <div className="text-xs text-muted-foreground">{formatThaiDateTime(a.decided_at)}{a.comment ? ` · ${a.comment}` : ''}</div>
            </div>
          ))}
        </div>
      )}

      {(canDecide || canCancel) && <PrDecision prId={id} canDecide={canDecide} canCancel={canCancel} />}
    </div>
  )
}
