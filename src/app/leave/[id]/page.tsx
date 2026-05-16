'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LeaveDetailPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const [request, setRequest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (params.id) fetchRequest()
  }, [params.id])

  async function fetchRequest() {
    const { data } = await supabase
      .from('leave_requests')
      .select('*, employee:employees(*), leave_type:leave_types(*), approval_actions(*, approver:approvers(*))')
      .eq('id', params.id)
      .single()
    setRequest(data)
    setLoading(false)
  }

  async function handleCancelPending() {
    setSubmitting(true)
    await supabase
      .from('leave_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
    router.push('/dashboard')
  }

  async function handleCancelApproved() {
    if (!cancelReason) return
    setSubmitting(true)
    await supabase
      .from('leave_requests')
      .update({
        cancel_reason: cancelReason,
        cancel_requested_at: new Date().toISOString(),
        cancel_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
    router.push('/dashboard')
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังโหลด...</p></div>
  }

  if (!request) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">ไม่พบข้อมูล</p></div>
  }

  const statusLabel: Record<string, string> = {
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    rejected: 'ไม่อนุมัติ',
    cancelled: 'ยกเลิกแล้ว',
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }

  const isOwner = session?.user?.employeeId === request.employee_id
  const canCancelPending = isOwner && request.status === 'pending'
  const canCancelApproved = isOwner && request.status === 'approved' && !request.cancel_status

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">รายละเอียดคำขอลา</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ข้อมูลคำขอ */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-800">{request.leave_type?.name}</p>
            <span className={`text-xs px-2 py-1 rounded-full ${statusColor[request.status]}`}>
              {statusLabel[request.status]}
            </span>
          </div>

          {request.cancel_status === 'pending' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              <p className="text-xs text-orange-700">⏳ รอ HR อนุมัติการยกเลิก</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-400">วันที่เริ่ม</p>
              <p className="text-gray-700">{request.start_date}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">วันที่สิ้นสุด</p>
              <p className="text-gray-700">{request.end_date}</p>
            </div>
            {request.total_days > 0 && (
              <div>
                <p className="text-xs text-gray-400">จำนวนวัน</p>
                <p className="text-gray-700">{request.total_days} วัน</p>
              </div>
            )}
            {request.late_minutes > 0 && (
              <div>
                <p className="text-xs text-gray-400">สายกี่นาที</p>
                <p className="text-gray-700">{request.late_minutes} นาที</p>
              </div>
            )}
          </div>

          {request.reason && (
            <div>
              <p className="text-xs text-gray-400">เหตุผล</p>
              <p className="text-sm text-gray-700">{request.reason}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-400">ยื่นเมื่อ</p>
            <p className="text-sm text-gray-700">
              {new Date(request.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* ประวัติการอนุมัติ */}
        {request.approval_actions?.length > 0 && (
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-2">ประวัติการอนุมัติ</p>
            <div className="space-y-2">
              {request.approval_actions.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-gray-700">{a.approver?.name}</p>
                    {a.comment && <p className="text-xs text-gray-400">{a.comment}</p>}
                  </div>
                  <span className={a.action === 'approved' ? 'text-green-600 text-xs' : 'text-red-500 text-xs'}>
                    {a.action === 'approved' ? '✅ อนุมัติ' : '❌ ไม่อนุมัติ'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ยกเลิกคำขอ pending */}
        {canCancelPending && (
          <button
            onClick={handleCancelPending}
            disabled={submitting}
            className="w-full border border-red-300 text-red-500 rounded-xl py-3 text-sm font-medium hover:bg-red-50 transition disabled:opacity-50"
          >
            ยกเลิกคำขอลา
          </button>
        )}

        {/* ยกเลิกคำขอที่ approved แล้ว */}
        {canCancelApproved && !showCancelForm && (
          <button
            onClick={() => setShowCancelForm(true)}
            className="w-full border border-orange-300 text-orange-500 rounded-xl py-3 text-sm font-medium hover:bg-orange-50 transition"
          >
            ขอยกเลิกการลา (ต้องรอ HR อนุมัติ)
          </button>
        )}

        {showCancelForm && (
          <div className="bg-white rounded-xl p-4 border border-orange-200 space-y-3">
            <p className="text-sm font-medium text-gray-700">เหตุผลในการขอยกเลิก</p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="ระบุเหตุผล..."
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowCancelForm(false)}
                className="border border-gray-300 text-gray-600 rounded-lg py-2 text-sm"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleCancelApproved}
                disabled={!cancelReason || submitting}
                className="bg-orange-500 text-white rounded-lg py-2 text-sm disabled:opacity-50"
              >
                ส่งคำขอยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}