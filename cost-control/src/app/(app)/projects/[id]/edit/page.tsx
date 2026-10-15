import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { ProjectForm } from '@/components/app/project-form'
import type { Project } from '@/lib/types'

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
  if (!project) notFound()

  const { data: members } = await supabase.from('project_members').select('user_id').eq('project_id', id)
  const canManage =
    user.profile.role === 'management' ||
    user.profile.role === 'admin' ||
    (user.profile.role === 'project_manager' && (members ?? []).some(m => m.user_id === user.id))
  if (!canManage) redirect(`/projects/${id}?error=forbidden`)

  const { data: branches } = await supabase.from('branches').select('id, code, name').order('code')

  return (
    <div className="max-w-xl">
      <PageHeader title="แก้ไขโครงการ" subtitle={`${project.code} ${project.name}`} backHref={`/projects/${id}`} />
      <ProjectForm branches={branches ?? []} project={project as Project} />
    </div>
  )
}
