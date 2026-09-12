import { PageHeader, EmptyState } from '@/components/app/common'

export function NotYetPage({ title, phase }: { title: string; phase: 2 | 3 }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState title="ยังไม่เปิดใช้งาน" hint={`ฟังก์ชันนี้อยู่ในเฟส ${phase} ของการพัฒนา`} />
    </div>
  )
}
