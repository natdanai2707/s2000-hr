import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/common'
import { ProjectForm } from '@/components/app/project-form'
import { JobNoticeEntry } from '@/components/app/job-notice-entry'
import type { ProfileOption } from '@/actions/job-notice'

// เปิด BOQ จากหน้านี้ต่อได้ทันที การอ่านโครงไฟล์ด้วย Claude ใช้เวลา จึงขยายเวลาเหมือนหน้านำเข้า BOQ
export const maxDuration = 300

export default async function NewProjectPage() {
  const supabase = await createClient()
  const [, { data: branches }, { data: profiles }] = await Promise.all([
    requireRole(['management', 'admin', 'project_manager']),
    supabase.from('branches').select('id, code, name').order('code'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true).order('full_name'),
  ])
  return (
    <div className="max-w-4xl">
      <PageHeader title="สร้างโครงการ" subtitle="วางข้อความแจ้งเปิด Job พร้อมแนบ BOQ หรือกรอกเองทีละช่อง" backHref="/projects" />
      <JobNoticeEntry
        branches={branches ?? []}
        profiles={(profiles ?? []) as ProfileOption[]}
        manual={
          <details className="mt-6 rounded border border-border bg-card">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">กรอกเองทีละช่อง</summary>
            <div className="border-t border-border p-4">
              <ProjectForm branches={branches ?? []} />
            </div>
          </details>
        }
      />
    </div>
  )
}
