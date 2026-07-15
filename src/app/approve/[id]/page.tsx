'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LeaveRequest } from '@/lib/types'

export default function ApprovePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const [request, setRequest] = useState<LeaveRequest | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [myLevel, setMyLevel] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (params.id) fetchRequest()
  }, [params.id, session])

  async function fetchRequest() {
    const { data } = await supabase
      .from('leave_requests')
      .select(`
        *,
        employee:employees(*),
        leave_type:leave_types(*),
        approval_actions(*, approver:approvers(*))
      `)
      .eq('id', params.id)
      .single()

    setRequest(data)

    // หา level ของผู้อนุมัตินี้ในสายอนุมัติ
    if (session?.user?.approverId && data) {
      const { data: chain } = await supabase
        .from('approval_chains')
        .select('level')
        .eq('employee_id', data.employee_id)
        .eq('approver_id', session.user.approverId)
        .maybeSingle()
      setMyLevel(chain?.level ?? null)
    }

    setLoading(false)
  }

  async function handleAction(action: 'approved' | 'rejected') {
    if (!request || !session?.user?.approverId || myLevel === null) return
    setSubmitting(true)
    setActionError('')

    try {
      // บันทึก action
      const { error: actErr } = await supabase.from('approval_actions').insert({
        leave_request_id: request.id,
        approver_id: session.user.approverId,
        level: myLevel,
        action,
        comment: comment || null,
      })
      if (actErr) throw actErr

      if (action === 'rejected') {
        // rejected ทันที
        const { error } = await supabase
          .from('leave_requests')
          .update({ status: 'rejected', updated_at: new Date().toISOString() })
          .eq('id', request.id)
        if (error) throw error
      } else {
        // ตรวจสอบว่ามี level ถัดไปไหม
        const { data: nextChain, error: chErr } = await supabase
          .from('approval_chains')
          .select('level')
          .eq('employee_id', request.employee_id)
          .eq('level', myLevel + 1)
          .maybeSingle()
        if (chErr) throw chErr

        const { error } = nextChain
          ? await supabase
              .from('leave_requests')
              .update({ current_approval_level: myLevel + 1, updated_at: new Date().toISOString() })
              .eq('id', request.id)
          : await supabase
              .from('leave_requests')
              .update({ status: 'approved', updated_at: new Date().toISOString() })
              .eq('id', request.id)
        if (error) throw error
      }

      router.push('/dashboard')
    } catch (e) {
      console.error('approve action error:', e)
      setActionError('บันทึกการอนุมัติไม่สำเร็จ กรุณาลองใหม่')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังโหลด...</p>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">ไม่พบคำขอนี้</p>
      </div>
    )
  }

  const canApprove =
    myLevel !== null &&
    request.status === 'pending' &&
    request.current_approval_level === myLevel

  const emp = (request as any).employee
  const lt = (request as any).leave_type
  const actions = (request as any).approval_actions || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">อนุมัติคำขอลา</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ข้อมูลคำขอ */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">พนักงาน</span>
            <span className="text-sm font-medium text-gray-800">{emp?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">ตำแหน่ง</span>
            <span className="text-sm text-gray-700">{emp?.position}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">ประเภท</span>
            <span className="text-sm text-gray-700">{lt?.name}</span>
          </div>
          {request.late_minutes > 0 ? (
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">สายกี่นาที</span>
              <span className="text-sm text-gray-700">{request.late_minutes} นาที</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">วันที่</span>
                <span className="text-sm text-gray-700">
                  {request.start_date}
                  {request.end_date !== request.start_date ? ` ถึง ${request.end_date}` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">รวม</span>
                <span className="text-sm font-medium text-gray-800">{request.total_days} วัน</span>
              </div>
            </>
          )}
          {request.reason && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-500">เหตุผล: {request.reason}</p>
            </div>
          )}
        </div>

        {/* ประวัติการอนุมัติ */}
        {actions.length > 0 && (
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-2">ประวัติการอนุมัติ</p>
            <div className="space-y-2">
              {actions.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{a.approver?.name} (Level {a.level})</span>
                  <span className={a.action === 'approved' ? 'text-green-600' : 'text-red-500'}>
                    {a.action === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ส่วนอนุมัติ */}
        {canApprove ? (
          <div className="space-y-3">
            {actionError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-red-600 text-sm">{actionError}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ (ถ้ามี)</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="ระบุหมายเหตุ..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleAction('rejected')}
                disabled={submitting}
                className="bg-red-50 text-red-600 border border-red-200 rounded-xl py-3 font-medium disabled:opacity-50"
              >
                ไม่อนุมัติ
              </button>
              <button
                onClick={() => handleAction('approved')}
                disabled={submitting}
                className="bg-[#06C755] text-white rounded-xl py-3 font-medium disabled:opacity-50"
              >
                อนุมัติ
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500">
              {request.status === 'approved' && 'คำขอนี้อนุมัติแล้ว'}
              {request.status === 'rejected' && 'คำขอนี้ถูกปฏิเสธแล้ว'}
              {request.status === 'pending' && 'ไม่ใช่คิวของคุณในการอนุมัติ'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}