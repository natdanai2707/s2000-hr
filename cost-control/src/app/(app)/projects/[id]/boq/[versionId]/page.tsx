import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, StatusBadge, Stat } from '@/components/app/common'
import { BOQ_VERSION_TYPE_LABELS, type BoqCategory } from '@/lib/types'
import { formatBaht, formatPct, toNumber } from '@/lib/format'
import { formatThaiDateTime } from '@/lib/date'
import { BoqVersionActions } from '@/components/app/boq-version-actions'
import { BoqItemsEditor, type EditableItem } from '@/components/app/boq-items-editor'

export default async function BoqVersionPage({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params
  const user = await requireUser()
  const supabase = await createClient()

  const { data: version } = await supabase.from('boq_versions').select('*, profiles!boq_versions_confirmed_by_fkey(full_name)').eq('id', versionId).eq('project_id', id).maybeSingle()
  if (!version) notFound()
  const [{ data: project }, { data: sections }, { data: items }, { data: members }] = await Promise.all([
    supabase.from('projects').select('id, code, name, status').eq('id', id).single(),
    supabase.from('boq_sections').select('id, code, name, sort_order').eq('boq_version_id', versionId).order('sort_order'),
    supabase.from('boq_items').select('*').eq('boq_version_id', versionId).order('sort_order'),
    supabase.from('project_members').select('user_id').eq('project_id', id),
  ])

  const isManagement = user.profile.role === 'management'
  const canEdit = version.status === 'draft' && (isManagement || user.profile.role === 'admin' || (user.profile.role === 'project_manager' && (members ?? []).some(m => m.user_id === user.id)))

  // สรุปแยกหมวด
  const secMap = new Map<string | null, { name: string; cost: number; sell: number; byCat: Record<string, number> }>()
  for (const s of sections ?? []) secMap.set(s.id, { name: s.name, cost: 0, sell: 0, byCat: {} })
  let totalCost = 0
  let totalSell = 0
  for (const it of items ?? []) {
    const key = it.section_id
    if (!secMap.has(key)) secMap.set(key, { name: 'ไม่ระบุหมวด', cost: 0, sell: 0, byCat: {} })
    const e = secMap.get(key)!
    const cost = toNumber(it.qty) * toNumber(it.unit_cost)
    const sell = toNumber(it.qty) * toNumber(it.sell_unit_price)
    e.cost += cost
    e.sell += sell
    e.byCat[it.category] = (e.byCat[it.category] ?? 0) + cost
    totalCost += cost
    totalSell += sell
  }
  const profit = totalSell - totalCost
  const profitPct = totalSell > 0 ? (profit / totalSell) * 100 : null

  return (
    <div>
      <PageHeader
        title={`BOQ เวอร์ชัน ${version.version_no} · ${BOQ_VERSION_TYPE_LABELS[version.type as keyof typeof BOQ_VERSION_TYPE_LABELS]}`}
        subtitle={`${project?.code ?? ''} ${project?.name ?? ''}`}
        backHref={`/projects/${id}`}
        actions={
          <BoqVersionActions
            projectId={id}
            versionId={versionId}
            status={version.status}
            canConfirm={isManagement && version.status === 'draft'}
            canCreateVo={version.status === 'confirmed' && (isManagement || canEditRole(user.profile.role))}
            hasItems={(items?.length ?? 0) > 0}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge kind="boq" status={version.status} />
        {version.confirmed_at && (
          <span className="text-muted-foreground">
            ยืนยันโดย {(version.profiles as unknown as { full_name: string } | null)?.full_name ?? ''} เมื่อ {formatThaiDateTime(version.confirmed_at)}
          </span>
        )}
        {version.note && <span className="text-muted-foreground">· {version.note}</span>}
        {version.source_file_path && <span className="text-muted-foreground">· ไฟล์ต้นทาง {version.source_file_path.split('/').pop()}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <Stat label="มูลค่าต้นทุนรวม" value={formatBaht(totalCost)} />
        <Stat label="ราคาขายรวม" value={formatBaht(totalSell)} />
        <Stat label="กำไรคาดหวัง" value={formatBaht(profit)} tone={profit < 0 ? 'danger' : 'success'} />
        <Stat label="กำไร (% ของราคาขาย)" value={profitPct === null ? '-' : formatPct(profitPct)} />
      </div>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">สรุปแยกตามหมวด</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {[...secMap.entries()].map(([key, s]) => {
            const p = s.sell - s.cost
            return (
              <div key={key ?? 'none'} className="px-4 py-3">
                <div className="flex justify-between gap-2 text-sm">
                  <div className="font-medium">{s.name}</div>
                  <div className="tabular text-right">
                    <span className="text-muted-foreground">ต้นทุน </span>{formatBaht(s.cost)}
                    <span className="text-muted-foreground"> · ขาย </span>{formatBaht(s.sell)}
                    <span className="text-muted-foreground"> · กำไร </span>
                    <span className={p < 0 ? 'text-danger-fg' : ''}>{formatBaht(p)} ({s.sell > 0 ? formatPct((p / s.sell) * 100) : '-'})</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {Object.entries(s.byCat).map(([c, v]) => `${catLabel(c as BoqCategory)} ${formatBaht(v)}`).join(' · ')}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">รายการ ({items?.length ?? 0})</h2>
        <BoqItemsEditor
          projectId={id}
          versionId={versionId}
          canEdit={canEdit}
          sections={(sections ?? []).map(s => ({ id: s.id, name: s.name }))}
          items={(items ?? []) as EditableItem[]}
        />
      </section>
      {version.status === 'confirmed' && (
        <p className="mt-3 text-xs text-muted-foreground">
          BOQ ที่ยืนยันแล้วเป็นงบที่ล็อก การเปลี่ยนแปลงต้องทำเป็น VO เท่านั้น <Link className="underline" href={`/projects/${id}/boq/import?type=variation_order`}>นำเข้า VO</Link>
        </p>
      )}
    </div>
  )
}

function canEditRole(role: string) {
  return role === 'project_manager' || role === 'admin'
}
function catLabel(c: BoqCategory) {
  return { material: 'วัสดุ', labor: 'แรงงาน', subcontract: 'ผู้รับเหมาช่วง', equipment: 'เครื่องจักร', other: 'อื่นๆ' }[c]
}
