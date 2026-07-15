'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { currentMonthISO, monthRange } from '@/lib/date'
import { StatusChip, EmptyState, PageHeader } from '@/components/ui'

export default function LeaveListPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterMonth, setFilterMonth] = useState(currentMonthISO())

  useEffect(() => {
    fetchRequests()
  }, [filterStatus, filterMonth])

  async function fetchRequests() {
    setLoading(true)
    const { start, end } = monthRange(filterMonth)
    let query = supabase
      .from('leave_requests')
      .select('*, employee:employees(employee_code, name, position), leave_type:leave_types(name, code)')
      .gte('start_date', start)
      .lte('start_date', end)
      .order('created_at', { ascending: false })

    if (filterStatus !== 'all') {
      query = query.eq('status', filterStatus)
    }

    const { data } = await query
    setRequests(data || [])
    setLoading(false)
  }

  const statusLabel: Record<string, string> = {
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    rejected: 'ไม่อนุมัติ',
    cancelled: 'ยกเลิก',
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="คำขอลาทั้งหมด" />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="month"
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
          />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="pending">รออนุมัติ</option>
            <option value="approved">อนุมัติแล้ว</option>
            <option value="rejected">ไม่อนุมัติ</option>
          </select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          {['pending', 'approved', 'rejected'].map(s => (
            <div key={s} className={`rounded-lg py-2 ${statusColor[s]}`}>
              <p className="font-bold text-lg">{requests.filter(r => r.status === s).length}</p>
              <p className="text-xs">{statusLabel[s]}</p>
            </div>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
        ) : requests.length === 0 ? (
          <EmptyState icon="🗂️" title="ไม่มีคำขอลาในช่วงนี้" hint="ลองเปลี่ยนเดือนหรือสถานะด้านบน" />
        ) : (
          <div className="space-y-2">
            {requests.map(req => (
              <div
                key={req.id}
                onClick={() => router.push(`/approve/${req.id}`)}
                className="bg-white rounded-xl p-4 border border-gray-100 cursor-pointer hover:bg-gray-50 transition"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">
                      {req.employee?.name}
                      <span className="text-gray-400 font-normal ml-1">({req.employee?.employee_code})</span>
                    </p>
                    <p className="text-sm text-gray-600">{req.leave_type?.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {req.start_date}
                      {req.end_date !== req.start_date ? ` ถึง ${req.end_date}` : ''}
                      {req.total_days > 0 ? ` · ${req.total_days} วัน` : ''}
                      {req.late_minutes > 0 ? ` · สาย ${req.late_minutes} นาที` : ''}
                    </p>
                    {req.reason && <p className="text-xs text-gray-400 mt-0.5">{req.reason}</p>}
                  </div>
                  <StatusChip status={req.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}