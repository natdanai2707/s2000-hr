import { requireUser, loadSettings } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/app/common'
import { PrForm, type PrFormProject } from '@/components/app/pr-form'

export default async function NewPrPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser()
  const { project } = await searchParams
  const supabase = await createClient()
  const settings = await loadSettings()

  // โครงการที่ผู้ใช้เป็นสมาชิกและมี BOQ ยืนยันแล้ว (RLS กรองให้แล้ว)
  const [{ data: memberships }, { data: suppliers }] = await Promise.all([
    supabase.from('project_members').select('project_id').eq('user_id', user.id),
    supabase.from('suppliers').select('id, name').order('name'),
  ])
  const memberIds = (memberships ?? []).map(m => m.project_id)
  const seesAll = user.profile.role === 'management' || user.profile.role === 'admin'
  const base = supabase.from('v_project_summary').select('project_id, code, name, confirmed_version_id, status').not('confirmed_version_id', 'is', null).in('status', ['active', 'closing'])
  const { data: summaries } = seesAll ? await base : memberIds.length ? await base.in('project_id', memberIds) : { data: [] }
  const versionIds = (summaries ?? []).map(s => s.confirmed_version_id as string)
  const { data: items } = versionIds.length
    ? await supabase
        .from('v_boq_item_costs')
        .select('boq_item_id, project_id, item_no, description, unit, category, is_off_boq, qty, unit_cost, qty_ordered, qty_remaining')
        .in('boq_version_id', versionIds)
        .order('item_no')
    : { data: [] }

  const projects: PrFormProject[] = (summaries ?? []).map(s => ({
    id: s.project_id,
    code: s.code,
    name: s.name,
    items: (items ?? [])
      .filter(i => i.project_id === s.project_id)
      .map(i => ({
        id: i.boq_item_id,
        item_no: i.item_no,
        description: i.description,
        unit: i.unit,
        category: i.category,
        is_off_boq: i.is_off_boq,
        qty: Number(i.qty),
        unit_cost: Number(i.unit_cost),
        qty_ordered: Number(i.qty_ordered),
      })),
  }))

  return (
    <div className="max-w-2xl">
      <PageHeader title="สร้างใบขอซื้อ" backHref="/pr" />
      {projects.length === 0 ? (
        <EmptyState title="ไม่มีโครงการที่สร้างใบขอซื้อได้" hint="ต้องเป็นสมาชิกโครงการที่ BOQ ยืนยันแล้ว" />
      ) : (
        <PrForm projects={projects} suppliers={suppliers ?? []} settings={settings} initialProjectId={project ?? null} />
      )}
    </div>
  )
}
