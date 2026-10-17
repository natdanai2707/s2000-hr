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

const FILTERS = [
  { key: 'active', label: 'กำลังดำเนินการ', statuses: ['active', 'closing'] },
  { key: 'all', label: 'ทั้งหมด', statuses: [] as string[] },
]

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string }> }) {
  const user = await requireUser()
  const { error, show } = await searchParams
  const filter = FILTERS.find(f => f.key === show) ?? FILTERS[0]
  const supabase = await createClient()
  const direct = usesDirectPurchase(await loadSettings(), user.profile.role)

  let q = supabase.from('v_project_summary').select('*')
  if (filter.statuses.length) q = q.in('status', filter.statuses)
  const { data } = await q
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
            className={cn('rounded-full border px-3 py-1', f.key === filter.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card')}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <CostOverview projects={projects} />
    </div>
  )
}
