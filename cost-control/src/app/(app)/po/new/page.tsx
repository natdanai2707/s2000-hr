import { notFound, redirect } from 'next/navigation'
import { requireRole, loadSettings } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { PoCreateForm } from '@/components/app/po-create-form'

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ pr?: string }> }) {
  await requireRole(['purchasing', 'management'])
  const { pr: prId } = await searchParams
  if (!prId) redirect('/po')
  const supabase = await createClient()
  const settings = await loadSettings()
  const { data: pr } = await supabase.from('purchase_requests').select('id, pr_no, status, total_amount, projects(code, name)').eq('id', prId).maybeSingle()
  if (!pr) notFound()
  if (pr.status !== 'approved') redirect(`/pr/${prId}`)
  const [{ data: items }, { data: suppliers }] = await Promise.all([
    supabase.from('purchase_request_items').select('id, description, qty, unit, unit_price, supplier_id, supplier_name').eq('pr_id', prId).order('created_at'),
    supabase.from('suppliers').select('id, name').order('name'),
  ])
  const proj = pr.projects as unknown as { code: string; name: string }
  const defaultSupplier = (items ?? []).find(i => i.supplier_id)?.supplier_id ?? ''

  return (
    <div className="max-w-2xl">
      <PageHeader title={`ออกใบสั่งซื้อจาก ${pr.pr_no}`} subtitle={`${proj.code} ${proj.name}`} backHref={`/pr/${prId}`} />
      <PoCreateForm
        prId={prId}
        items={(items ?? []).map(i => ({ id: i.id, description: i.description, qty: Number(i.qty), unit: i.unit, unit_price: Number(i.unit_price), supplier_name: i.supplier_name }))}
        suppliers={suppliers ?? []}
        defaultSupplierId={defaultSupplier}
        thresholdPct={settings.price_variance_threshold_pct}
      />
    </div>
  )
}
