import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { ProjectForm } from '@/components/app/project-form'

export default async function NewProjectPage() {
  await requireRole(['management', 'admin', 'project_manager'])
  const supabase = await createClient()
  const { data: branches } = await supabase.from('branches').select('id, code, name').order('code')
  return (
    <div className="max-w-xl">
      <PageHeader title="สร้างโครงการ" backHref="/projects" />
      <ProjectForm branches={branches ?? []} />
    </div>
  )
}
