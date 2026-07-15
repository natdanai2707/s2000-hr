'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function OTApprovePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const [request, setRequest] = useState<any>(null)
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
      .from('ot_requests')
      .select('*, employee:employees(*), ot_approval_actions(*, approver:approvers(*))')
      .eq('id', params.id)
      .single()
    setRequest(data)

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
      const { error: actErr } = await supabase.from('ot_approval_actions').insert({
        ot_request_id: request.id,
        approver_id: session.user.approverId,
        level: myLevel,
        action,
        comment: comment || null,
      })
      if (actErr) throw actErr

      if (action === 'rejected') {
        const { error } = await supabase.from('ot_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', request.id)
        if (error) throw error
      } else {
        const { data: nextChain, error: chErr } = await supabase
          .from('approval_chains')
          .select('level')
          .eq('employee_id', request.employee_id)
          .eq('level', myLevel + 1)
          .maybeSingle()
        if (chErr) throw chErr

        const { error } = nextChain
          ? await supabase.from('ot_requests').update({ current_approval_level: myLevel + 1, updated_at: new Date().toISOString() }).eq('id', request.id)
          : await supabase.from('ot_requests').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', request.id)
        if (error) throw error
      }

      router.push('/dashboard')
    } catch (e) {
      console.error('ot approve action error:', e)
      setActionError('บันทึกการอนุมัติไม่สำเร็จ กรุณาลองใหม่')
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">กำลังโหลด...</p></div>
  if (!request) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-400">ไม่พบข้อมูล</p></div>

  const canApprove = myLevel !== null && request.status === 'pending' && request.current_approval_level === myLevel
  const emp = request.employee
  const actions = request.ot_approval_actions || []

  const dayTypeLabel: Record<string, string> = { normal: 'วันทำงานปกติ', weekend: 'วันหยุดประจำสัปดาห์', holiday: 'วันหยุดนักขัตฤกษ์' }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <h1 className="font-semibold text-gray-800">อนุมัติคำขอ OT</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-2.5">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-gray-800">{emp?.name}</p>
              <p className="text-xs text-gray-400">{emp?.position}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : request.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><p className="text-xs text-gray-400">วันที่</p><p>{request.request_date}</p></div>
            <div><p className="text-xs text-gray-400">ประเภทวัน</p><p>{dayTypeLabel[request.day_type]}</p></div>
            <div><p className="text-xs text-gray-400">เวลา OT</p><p>{request.ot_start} - {request.ot_end}</p></div>
            <div><p className="text-xs text-gray-400">ชม. OT จริง</p><p>{request.ot_hours} ชม.</p></div>
            <div><p className="text-xs text-gray-400">ตัวคูณ</p><p>{request.multiplier}x</p></div>
            <div><p className="text-xs text-gray-400">ชม. OT คิดเงิน</p><p className="font-semibold text-green-700">{request.ot_hours_multiplied} ชม.</p></div>
          </div>

          <div><p className="text-xs text-gray-400">งานที่ทำ</p><p className="text-sm text-gray-700">{request.work_description}</p></div>
          {request.reason && <div><p className="text-xs text-gray-400">เหตุผล</p><p className="text-sm text-gray-700">{request.reason}</p></div>}
        </div>

        {actions.length > 0 && (
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-2">ประวัติการอนุมัติ</p>
            {actions.map((a: any) => (
              <div key={a.id} className="flex justify-between text-sm">
                <span className="text-gray-600">{a.approver?.name} (Level {a.level})</span>
                <span className={a.action === 'approved' ? 'text-green-600' : 'text-red-500'}>{a.action === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}</span>
              </div>
            ))}
          </div>
        )}

        {canApprove ? (
          <div className="space-y-3">
            {actionError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-red-600 text-sm">{actionError}</p>
              </div>
            )}
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" placeholder="หมายเหตุ (ถ้ามี)" />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleAction('rejected')} disabled={submitting} className="bg-red-50 text-red-600 border border-red-200 rounded-xl py-3 font-medium disabled:opacity-50">ไม่อนุมัติ</button>
              <button onClick={() => handleAction('approved')} disabled={submitting} className="bg-orange-500 text-white rounded-xl py-3 font-medium disabled:opacity-50">อนุมัติ</button>
            </div>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500">
              {request.status === 'approved' && 'OT นี้อนุมัติแล้ว'}
              {request.status === 'rejected' && 'OT นี้ถูกปฏิเสธแล้ว'}
              {request.status === 'pending' && 'ไม่ใช่คิวของคุณในการอนุมัติ'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}