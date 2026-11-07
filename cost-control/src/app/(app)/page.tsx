import Link from 'next/link'
import { requireUser, loadSettings } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { usesDirectPurchase, type ProjectSummary } from '@/lib/types'
import { PageHeader } from '@/components/app/common'
import { CostOverview } from '@/components/app/cost-overview'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { consumedPct } from '@/lib/cost'
import { cn } from '@/lib/utils'
import { FINISHED_STATUSES, closeoutWarnings, isFinished, type CloseoutFigures, type CloseoutWarning } from '@/lib/closeout'

const FILTERS = [
  { key: 'active', label: 'กำลังดำเนินการ', statuses: ['active'] },
  { key: 'finished', label: 'งานเสร็จแล้ว', statuses: FINISHED_STATUSES as string[] },
  { key: 'all', label: 'ทั้งหมด', statuses: [] as string[] },
]

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string }> }) {
  const { error, show } = await searchParams
  const filter = FILTERS.find(f => f.key === show) ?? FILTERS[0]
  const supabase = await createClient()

  let q = supabase.from('v_project_summary').select('*')
  if (filter.statuses.length) q = q.in('status', filter.statuses)
  // ป้ายเตือนงานเสร็จแล้ว (ยังไม่ส่งงาน วางบิล รับเงิน) อ่านจาก view รายรับพร้อมกัน
  const [user, settings, { data }, { data: recv }] = await Promise.all([
    requireUser(),
    loadSettings(),
    q,
    filter.key === 'active' ? Promise.resolve({ data: [] }) : supabase.from('v_project_receivables').select('*').in('status', FINISHED_STATUSES),
  ])
  const direct = usesDirectPurchase(settings, user.profile.role)
  const warnings: Record<string, CloseoutWarning[]> = {}
  for (const r of (recv ?? []) as (CloseoutFigures & { project_id: string; status: string })[]) {
    if (isFinished(r.status)) warnings[r.project_id] = closeoutWarnings(r)
  }
  // โครงการที่ใช้ต้นทุนไปมากที่สุดเทียบงบขึ้นก่อน โครงการที่ยังไม่มีงบอยู่ท้าย
  const projects = ((data ?? []) as ProjectSummary[]).sort((a, b) => (consumedPct(b) ?? -1) - (consumedPct(a) ?? -1))
  const canCreate = ['management', 'admin', 'project_manager'].includes(user.profile.role)
  const seesAll = user.profile.role === 'management' || user.profile.role === 'admin'

  return (
    <div>
      <PageHeader
        title={direct ? 'ภาพรวมต้นทุน' : 'แดชบอร์ด'}
        subtitle={seesAll ? 'ทุกโครงการทุกสาขา' : 'โครงการที่คุณเป็นสมาชิก'}
        actions={
          <>
            {direct && <Button asChild><Link href="/pr/new">บันทึกการสั่งซื้อ</Link></Button>}
            {canCreate && <Button asChild variant="outline"><Link href="/projects/new">สร้างโครงการ</Link></Button>}
          </>
        }
      />
      {error === 'forbidden' && <Alert tone="danger" className="mb-4">คุณไม่มีสิทธิ์เข้าถึงหน้าที่ร้องขอ</Alert>}

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(f => (
          <Link
            key={f.key}
            href={f.key === 'active' ? '/' : `/?show=${f.key}`}
            className={cn('inline-flex h-10 items-center rounded border px-3 font-medium', f.key === filter.key ? 'bg-primary text-primary-foreground border-primary' : 'border-input bg-background hover:bg-muted')}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <CostOverview projects={projects} closeout={warnings} />
    </div>
  )
}
