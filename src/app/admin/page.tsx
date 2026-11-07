'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // guard: เฉพาะ admin เท่านั้น
  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.isAdmin) {
      router.replace('/dashboard')
    }
  }, [session, status, router])

  if (status === 'loading' || !session?.user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    )
  }

  const menus = [
    { icon: '📊', label: 'ออก Payroll (Excel)', sub: 'สรุปเงินเดือน/ค่าแรง 4 ชีต', href: '/admin/export' },
    { icon: '📄', label: 'ใบปฏิบัติงาน (Excel)', sub: 'รายวัน แยกรายคน', href: '/admin/export-worklog' },
    { icon: '🏗️', label: 'ต้นทุนแรงงานต่องาน', sub: 'รายงานต้นทุนต่อโปรเจกต์', href: '/admin/project-cost' },
    { icon: '👤', label: 'จัดการพนักงาน & เรท', sub: 'เพิ่ม/แก้พนักงาน ค่าแรง โควต้า', href: '/admin/staff' },
    { icon: '👥', label: 'สรุปทีมวันนี้', sub: 'ใครลา/อยู่ไซต์ไหน', href: '/team' },
    { icon: '🔗', label: 'ผูก Line ID', sub: 'ตั้งค่าแจ้งเตือน LINE พนักงาน/หัวหน้า', href: '/admin/employees' },
    { icon: '📍', label: 'จัดการไซต์งาน', sub: 'พิกัด GPS geofencing', href: '/admin/sites' },
    { icon: '🔒', label: 'รอบ Payroll', sub: 'เปิด/ปิดรอบจ่ายเงิน', href: '/admin/payroll-periods' },
  ]

  const isManager = session?.user?.isManager

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        {isManager ? (
          <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center font-bold -ml-1">S2</div>
        ) : (
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 min-w-11 min-h-11 -ml-2 flex items-center">←</button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-800">จัดการระบบ</h1>
          <p className="text-xs text-gray-400">{isManager ? `ผู้จัดการ · ${session?.user?.name || ''}` : 'สำหรับ HR / ผู้ดูแลระบบ'}</p>
        </div>
        {isManager && (
          <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-xs text-gray-400 min-h-11 px-2">ออกจากระบบ</button>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {menus.map(m => (
          <button
            key={m.href}
            onClick={() => router.push(m.href)}
            className="w-full bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-4 text-left hover:bg-gray-50 transition min-h-16"
          >
            <span className="text-2xl">{m.icon}</span>
            <div className="flex-1">
              <p className="font-medium text-gray-800 text-sm">{m.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
            </div>
            <span className="text-gray-300">›</span>
          </button>
        ))}
      </div>
    </div>
  )
}
