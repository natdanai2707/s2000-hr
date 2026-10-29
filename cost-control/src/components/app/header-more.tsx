'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ปุ่มรองของหน้า บนมือถือพับไว้ใต้ปุ่ม เพิ่มเติม ให้หน้าไม่รกและไม่กดปุ่มลบโดยบังเอิญ บนจอใหญ่แสดงเรียงตามปกติ
export function HeaderMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="md:hidden inline-flex h-11 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium"
      >
        {open ? 'ปิดเมนู' : 'เพิ่มเติม'}
      </button>
      <div className={cn(open ? 'flex' : 'hidden', 'w-full flex-col gap-2 md:flex md:w-auto md:flex-row md:flex-wrap [&>*]:w-full md:[&>*]:w-auto')}>
        {children}
      </div>
    </>
  )
}
