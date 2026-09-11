import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { BoqImportWizard } from '@/components/app/boq-import-wizard'

export default async function BoqImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
  const { id } = await params
  const { type } = await searchParams
  await requireUser()
  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('id, name, code').eq('id', id).maybeSingle()
  if (!project) notFound()
  const { count } = await supabase.from('boq_versions').select('id', { count: 'exact', head: true }).eq('project_id', id).eq('status', 'confirmed')
  const hasConfirmed = (count ?? 0) > 0

  return (
    <div>
      <PageHeader title="นำเข้า BOQ" subtitle={`${project.code} ${project.name}`} backHref={`/projects/${id}`} />
      <BoqImportWizard projectId={id} hasConfirmed={hasConfirmed} initialType={type === 'variation_order' && hasConfirmed ? 'variation_order' : 'quotation'} />
    </div>
  )
}
