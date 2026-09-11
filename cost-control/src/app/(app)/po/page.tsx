import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusBadge, Money } from '@/components/app/common'
import { formatThaiDate } from '@/lib/date'
import { SupplierDialog } from '@/components/app/supplier-dialog'

export default async function PoListPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const isPurchasing = user.profile.role === 'purchasing' || user.profile.role === 'management'
  const [{ data: pos }, { data: approvedPrs }, { data: suppliers }] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select('id, po_no, status, total_amount, issued_at, projects(code, name), suppliers(name)')
      .order('issued_at', { ascending: false })
      .limit(200),
    isPurchasing
      ? supabase
          .from('purchase_requests')
          .select('id, pr_no, total_amount, needed_by_date, projects(code, name), purchase_orders(id, status)')
          .eq('status', 'approved')
          .order('submitted_at')
      : Promise.resolve({ data: [] }),
    supabase.from('suppliers').select('id, name, tax_id, phone').order('name'),
  ])
  const prsWithoutPo = (approvedPrs ?? []).filter(pr => !(pr.purchase_orders as unknown as { status: string }[] | null)?.some(p => p.status !== 'cancelled'))

  return (
    <div>
      <PageHeader title="ใบสั่งซื้อ" actions={isPurchasing ? <SupplierDialog /> : undefined} />

      {isPurchasing && (
        <section className="mb-6">
          <h2 className="font-semibold mb-2">ใบขอซื้อที่อนุมัติแล้ว รอออก PO ({prsWithoutPo.length})</h2>
          {prsWithoutPo.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มี</p>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {prsWithoutPo.map(pr => {
                const proj = pr.projects as unknown as { code: string; name: string } | null
                return (
                  <Link key={pr.id} href={`/po/new?pr=${pr.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="font-medium">{pr.pr_no} <span className="text-muted-foreground font-normal text-sm">· {proj?.name ?? ''}</span></div>
                      <div className="text-xs text-muted-foreground">ต้องการ {pr.needed_by_date ? formatThaiDate(pr.needed_by_date) : '-'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <Money value={pr.total_amount} className="block font-medium" />
                      <span className="text-xs text-primary">ออก PO</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      )}

      <section className="mb-6">
        <h2 className="font-semibold mb-2">ใบสั่งซื้อทั้งหมด</h2>
        {!pos?.length ? (
          <EmptyState title="ยังไม่มีใบสั่งซื้อ" />
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {pos.map(po => {
              const proj = po.projects as unknown as { code: string; name: string } | null
              const sup = po.suppliers as unknown as { name: string } | null
              return (
                <Link key={po.id} href={`/po/${po.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="font-medium">{po.po_no} <span className="text-muted-foreground font-normal text-sm">· {proj?.name ?? ''}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{sup?.name ?? 'ไม่ระบุซัพพลายเออร์'} · ออก {formatThaiDate(po.issued_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <Money value={po.total_amount} className="block font-medium" />
                    <StatusBadge kind="po" status={po.status} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">ซัพพลายเออร์ ({suppliers?.length ?? 0})</h2>
        {!suppliers?.length ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีซัพพลายเออร์</p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border text-sm">
            {suppliers.map(s => (
              <div key={s.id} className="px-4 py-2.5 flex justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{[s.tax_id, s.phone].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
