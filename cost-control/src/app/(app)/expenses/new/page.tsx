import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/app/common'
import { ExpenseForm } from '@/components/app/expense-form'

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser()
  const { project } = await searchParams
  const supabase = await createClient()
  const { data: memberships } = await supabase.from('project_members').select('project_id').eq('user_id', user.id)
  const ids = (memberships ?? []).map(m => m.project_id)
  const { data: summaries } = user.profile.role === 'management' || user.profile.role === 'accounting'
    ? await supabase.from('v_project_summary').select('project_id, code, name, confirmed_version_id').not('confirmed_version_id', 'is', null).in('status', ['active', 'closing'])
    : ids.length
      ? await supabase.from('v_project_summary').select('project_id, code, name, confirmed_version_id').in('project_id', ids).not('confirmed_version_id', 'is', null).in('status', ['active', 'closing'])
      : { data: [] }
  const versionIds = (summaries ?? []).map(s => s.confirmed_version_id as string)
  const { data: items } = versionIds.length
    ? await supabase.from('boq_items').select('id, boq_version_id, item_no, description, unit, is_off_boq').in('boq_version_id', versionIds).order('sort_order')
    : { data: [] }

  const projects = (summaries ?? []).map(s => ({
    id: s.project_id,
    code: s.code,
    name: s.name,
    items: (items ?? []).filter(i => i.boq_version_id === s.confirmed_version_id).map(i => ({ id: i.id, item_no: i.item_no, description: i.description, unit: i.unit, is_off_boq: i.is_off_boq })),
  }))

  return (
    <div className="max-w-xl">
      <PageHeader title="บันทึกค่าใช้จ่ายเบ็ดเตล็ด" subtitle="ค่าใช้จ่ายที่ไม่ผ่านใบสั่งซื้อ เช่น ค่าน้ำมัน ค่าที่พัก นับเป็นต้นทุนจริงและชำระแล้วทันที" backHref="/" />
      {projects.length === 0 ? <EmptyState title="ไม่มีโครงการที่บันทึกได้" hint="ต้องเป็นสมาชิกโครงการที่ BOQ ยืนยันแล้ว" /> : <ExpenseForm projects={projects} initialProjectId={project ?? null} />}
    </div>
  )
}
