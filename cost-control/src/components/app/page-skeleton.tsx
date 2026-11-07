// โครงหน้าระหว่างรอข้อมูล: กดเมนูแล้วเห็นหน้าใหม่ทันที ไม่ค้างอยู่หน้าเดิมระหว่างรอเซิร์ฟเวอร์
export default function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="animate-pulse">
      <div className="mb-5 border-b-2 border-foreground pb-3">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="mt-2 h-4 w-64 max-w-full rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="border-t-2 border-border pt-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="mt-2 h-6 w-28 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-8 border-t-2 border-border">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center justify-between gap-4 border-b border-border py-4">
            <div className="flex-1">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
            </div>
            <div className="h-4 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
