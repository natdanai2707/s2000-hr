import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { ReceiveForm } from '@/components/app/receive-form'

export default async function ReceivePage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params
  await requireUser()
  const supabase = await createClient()
  const { data: po } = await supabase.from('purchase_orders').select('id, po_no, status, projects(code, name)').eq('id', poId).maybeSingle()
  if (!po) notFound()
  const [{ data: items }, { data: received }] = await Promise.all([
    supabase.from('purchase_order_items').select('id, boq_item_id, description, qty, unit, unit_price, boq_items(item_no, description)').eq('po_id', poId).order('created_at'),
    supabase.from('goods_receipt_items').select('po_item_id, qty_received, goods_receipts!inner(po_id)').eq('goods_receipts.po_id', poId),
  ])
  const recMap = new Map<string, number>()
  for (const r of received ?? []) recMap.set(r.po_item_id, (recMap.get(r.po_item_id) ?? 0) + Number(r.qty_received))
  const proj = po.projects as unknown as { code: string; name: string }
  return (
    <div className="max-w-2xl">
      <PageHeader title={`รับของ ${po.po_no}`} subtitle={`${proj.code} ${proj.name}`} backHref={`/po/${poId}`} />
      <ReceiveForm
        poId={poId}
        items={(items ?? []).map(i => {
          const b = i.boq_items as unknown as { item_no: string | null; description: string } | null
          return { po_item_id: i.id, boq_item_id: i.boq_item_id, label: `${b?.item_no ? `${b.item_no} ` : ''}${i.description ?? b?.description ?? ''}`, qty: Number(i.qty), unit: i.unit, unit_price: Number(i.unit_price), received: recMap.get(i.id) ?? 0 }
        })}
      />
    </div>
  )
}
