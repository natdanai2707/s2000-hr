import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ProjectSummary } from '@/lib/types'
import { PageHeader, EmptyState } from '@/components/app/common'
import { ProjectCard } from '@/components/app/project-card'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser()
  const { error } = await searchParams
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_project_summary')
    .select('*')
    .in('status', ['active', 'closing'])
    .order('planned_end_date', { ascending: true, nullsFirst: false })
  const projects = (data ?? []) as ProjectSummary[]
  const canCreate = ['management', 'admin', 'project_manager'].includes(user.profile.role)

  return (
    <div>
      <PageHeader
        title="แดชบอร์ด"
        subtitle={user.profile.role === 'management' || user.profile.role === 'admin' ? 'โครงการที่กำลังดำเนินการทุกสาขา' : 'โครงการที่คุณเป็นสมาชิก'}
        actions={canCreate ? <Button asChild variant="outline"><Link href="/projects/new">สร้างโครงการ</Link></Button> : undefined}
      />
      {error === 'forbidden' && <Alert tone="danger" className="mb-4">คุณไม่มีสิทธิ์เข้าถึงหน้าที่ร้องขอ</Alert>}
      {projects.length === 0 ? (
        <EmptyState title="ยังไม่มีโครงการที่กำลังดำเนินการ" hint="โครงการจะแสดงที่นี่เมื่อ BOQ ได้รับการยืนยัน" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(p => (
            <ProjectCard key={p.project_id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}
