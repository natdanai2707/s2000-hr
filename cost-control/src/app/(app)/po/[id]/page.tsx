import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatBaht, formatQty } from '@/lib/format'
import { formatThaiDateTime } from '@/lib/date'
import { PoCancelButton } from '@/components/app/po-cancel-button'
import { AttachmentLink } from '@/components/app/attachment-link'

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createClient()
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*, projects(id, code, name), suppliers(name), purchase_requests(id, pr_no)')
    .eq('id', id)
    .maybeSingle()
  if (!po) notFound()
  const [{ data: items }, { data: receipts }, { data: invoices }, { data: members }] = await Promise.all([
    supabase.from('purchase_order_items').select('*, boq_items(item_no, description)').eq('po_id', id).order('created_at'),
    supabase.from('goods_receipts').select('*, profiles!goods_receipts_received_by_fkey(full_name), goods_receipt_items(id, po_item_id, qty_received, unit_cost)').eq('po_id', id).order('received_at'),
    supabase.from('invoices').select('id, invoice_no, amount, status, due_date').eq('po_id', id),
    supabase.from('project_members').select('user_id').eq('project_id', po.project_id),
  ])
  const proj = po.projects as unknown as { id: string; code: string; name: string }
  const role = user.profile.role
  const isMember = (members ?? []).some(m => m.user_id === user.id)
  const canReceive = po.status !== 'cancelled' && po.status !== 'received' && (((role === 'site_supervisor' || role === 'project_manager') && isMember) || role === 'purchasing' || role === 'management')
  const canCancel = (role === 'purchasing' || role === 'management') && po.status === 'issued' && !receipts?.length
  const receivedByItem = new Map<string, number>()
  for (const r of receipts ?? []) for (const it of (r.goods_receipt_items as { po_item_id: string; qty_received: number }[]) ?? []) receivedByItem.set(it.po_item_id, (receivedByItem.get(it.po_item_id) ?? 0) + Number(it.qty_received))

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={po.po_no}
        subtitle={`${proj.code} ${proj.name}`}
        backHref="/po"
        actions={
          <>
            {canReceive && <Button asChild><Link href={`/receiving/${id}`}>รับของ</Link></Button>}
            {canCancel && <PoCancelButton poId={id} />}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge kind="po" status={po.status} />
        <span className="text-muted-foreground">ออก {formatThaiDateTime(po.issued_at)}</span>
        {po.purchase_requests && <Link href={`/pr/${(po.purchase_requests as unknown as { id: string }).id}`} className="text-xs underline">จาก {(po.purchase_requests as unknown as { pr_no: string }).pr_no}</Link>}
      </div>
      <div className="rounded-xl border border-border bg-card p-4 text-sm grid grid-cols-2 gap-3 mb-4">
        <div><div className="text-xs text-muted-foreground">ซัพพลายเออร์</div><div>{(po.suppliers as unknown as { name: string } | null)?.name ?? 'ไม่ระบุ'}</div></div>
        <div><div className="text-xs text-muted-foreground">มูลค่ารวม</div><Money value={po.total_amount} className="font-semibold" /></div>
      </div>

      <h2 className="font-semibold mb-2">รายการ</h2>
      <div className="space-y-2 mb-4">
        {(items ?? []).map(it => {
          const b = it.boq_items as unknown as { item_no: string | null; description: string } | null
          const rec = receivedByItem.get(it.id) ?? 0
          return (
            <div key={it.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="font-medium">{b?.item_no ? `${b.item_no} ` : ''}{it.description ?? b?.description}</div>
              <div className="flex justify-between mt-1">
                <span className="tabular">{formatQty(it.qty)} {it.unit ?? ''} × {formatBaht(it.unit_price)}</span>
                <span className="tabular font-medium">{formatBaht(Number(it.qty) * Number(it.unit_price))}</span>
              </div>
              <div className="text-xs text-muted-foreground">รับแล้ว {formatQty(rec)} / {formatQty(it.qty)} {it.unit ?? ''}</div>
            </div>
          )
        })}
      </div>

      <h2 className="font-semibold mb-2">ประวัติรับของ</h2>
      {!receipts?.length ? (
        <p className="text-sm text-muted-foreground mb-4">ยังไม่มีการรับของ</p>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border mb-4 text-sm">
          {receipts.map(r => (
            <div key={r.id} className="px-4 py-2.5">
              <div className="flex justify-between">
                <span>{formatThaiDateTime(r.received_at)} · {(r.profiles as unknown as { full_name: string } | null)?.full_name ?? ''}</span>
                <span className="text-xs text-muted-foreground">{r.source === 'internal_stock' ? 'จากสต็อกภายใน (ราคาทุน)' : 'จากซัพพลายเออร์'}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {((r.goods_receipt_items as { qty_received: number; unit_cost: number }[]) ?? []).map(x => `${formatQty(x.qty_received)} × ${formatBaht(x.unit_cost)}`).join(' · ')}
                {r.note ? ` · ${r.note}` : ''}
              </div>
              {r.attachment_path && <AttachmentLink path={r.attachment_path} label="เปิดรูปแนบ" />}
            </div>
          ))}
        </div>
      )}

      <h2 className="font-semibold mb-2">ใบแจ้งหนี้</h2>
      {!invoices?.length ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีใบแจ้งหนี้</p>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border text-sm">
          {invoices.map(inv => (
            <div key={inv.id} className="px-4 py-2.5 flex justify-between items-center">
              <span>{inv.invoice_no}</span>
              <span className="flex items-center gap-2"><Money value={inv.amount} /><StatusBadge kind="invoice" status={inv.status} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
