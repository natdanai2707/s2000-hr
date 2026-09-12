import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { Button } from '@/components/ui/button'
import { formatThaiDate } from '@/lib/date'
import { InvoiceDialog, PaymentDialog, ApproveInvoiceButton } from '@/components/app/finance-dialogs'
import { formatBaht, toNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { todayISO, daysBetween } from '@/lib/date'

export default async function FinancePage() {
  const user = await requireUser()
  const supabase = await createClient()
  const isAccounting = user.profile.role === 'accounting' || user.profile.role === 'management'
  const [{ data: invoices }, { data: pos }, { data: suppliers }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_no, invoice_date, amount, due_date, status, projects(code, name), suppliers(name), purchase_orders(po_no), payments(amount)')
      .order('invoice_date', { ascending: false })
      .limit(300),
    isAccounting ? supabase.from('purchase_orders').select('id, po_no, total_amount, supplier_id, projects(name)').neq('status', 'cancelled').order('issued_at', { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
    supabase.from('suppliers').select('id, name').order('name'),
  ])
  const today = todayISO()

  return (
    <div>
      <PageHeader
        title="การรับของและชำระเงิน"
        actions={
          <>
            <Button asChild variant="outline"><Link href="/receiving">รับของ</Link></Button>
            {isAccounting && (
              <InvoiceDialog
                pos={(pos ?? []).map(p => ({ id: p.id, po_no: p.po_no, total_amount: Number(p.total_amount), supplier_id: p.supplier_id, project_name: (p.projects as unknown as { name: string } | null)?.name ?? '' }))}
                suppliers={suppliers ?? []}
              />
            )}
          </>
        }
      />
      {!invoices?.length ? (
        <EmptyState title="ยังไม่มีใบแจ้งหนี้" />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {invoices.map(inv => {
            const paid = ((inv.payments as { amount: number }[]) ?? []).reduce((s, p) => s + toNumber(p.amount), 0)
            const remaining = toNumber(inv.amount) - paid
            const dueDays = inv.due_date ? daysBetween(today, inv.due_date) : null
            return (
              <div key={inv.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {inv.invoice_no} <span className="text-muted-foreground font-normal text-sm">· {(inv.suppliers as unknown as { name: string } | null)?.name ?? '-'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(inv.projects as unknown as { name: string } | null)?.name ?? ''} · {(inv.purchase_orders as unknown as { po_no: string } | null)?.po_no ?? 'สัญญาผู้รับเหมาช่วง'} · ลงวันที่ {formatThaiDate(inv.invoice_date)}
                    {inv.due_date && (
                      <span className={cn(inv.status !== 'paid' && dueDays !== null && dueDays <= 3 && 'text-danger-fg')}> · ครบกำหนด {formatThaiDate(inv.due_date)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Money value={inv.amount} className="block font-medium" />
                    {paid > 0 && inv.status !== 'paid' && <div className="text-xs text-muted-foreground">คงเหลือ {formatBaht(remaining)}</div>}
                    <StatusBadge kind="invoice" status={inv.status} />
                  </div>
                  {isAccounting && inv.status === 'received' && <ApproveInvoiceButton invoiceId={inv.id} />}
                  {isAccounting && inv.status !== 'paid' && <PaymentDialog invoiceId={inv.id} invoiceNo={inv.invoice_no} remaining={remaining} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
