// LINE Messaging API helpers (server-side only — ใช้ LINE_MESSAGING_TOKEN)
import { createClient } from '@supabase/supabase-js'
import { formatThaiDate } from './date'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ส่งข้อความ push ไปยัง LINE user id (เงียบถ้าไม่มี token/ปลายทาง)
export async function pushLine(to: string | null | undefined, text: string): Promise<void> {
  const token = process.env.LINE_MESSAGING_TOKEN
  if (!token || !to) return
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      console.error('LINE push failed:', res.status, await res.text())
    }
  } catch (e) {
    console.error('LINE push error:', e)
  }
}

type RequestType = 'leave' | 'ot'

// ดึงรายการ line_user_id ของผู้อนุมัติที่ต้องอนุมัติ ณ level ปัจจุบัน
async function approverLineIds(employeeId: string, level: number): Promise<string[]> {
  const { data: chains } = await supabase
    .from('approval_chains')
    .select('approver_id')
    .eq('employee_id', employeeId)
    .eq('level', level)
  const ids = (chains || []).map(c => c.approver_id)
  if (ids.length === 0) return []

  const { data: approvers } = await supabase
    .from('approvers')
    .select('line_user_id')
    .in('id', ids)
    .eq('is_active', true)
  return (approvers || []).map(a => a.line_user_id).filter((x): x is string => !!x)
}

// สรุปข้อความคำขอสั้นๆ
function describeRequest(type: RequestType, req: any): string {
  if (type === 'ot') {
    return `OT วันที่ ${req.request_date} เวลา ${req.ot_start}-${req.ot_end} (${req.ot_hours} ชม. ${req.multiplier}x)`
  }
  const name = req.leave_type?.name || 'การลา'
  if (req.late_minutes > 0) return `${name} (สาย ${req.late_minutes} นาที)`
  const range =
    req.end_date && req.end_date !== req.start_date
      ? `${req.start_date} ถึง ${req.end_date}`
      : req.start_date
  return `${name} ${range}${req.total_days > 0 ? ` (${req.total_days} วัน)` : ''}`
}

async function fetchRequest(type: RequestType, requestId: string) {
  if (type === 'ot') {
    const { data } = await supabase
      .from('ot_requests')
      .select('*, employee:employees(name, line_user_id)')
      .eq('id', requestId)
      .maybeSingle()
    return data
  }
  const { data } = await supabase
    .from('leave_requests')
    .select('*, employee:employees(name, line_user_id), leave_type:leave_types(name)')
    .eq('id', requestId)
    .maybeSingle()
  return data
}

// แจ้งผู้อนุมัติเมื่อมีคำขอใหม่เข้ามา
export async function notifyNewRequest(type: RequestType, requestId: string): Promise<void> {
  const req = await fetchRequest(type, requestId)
  if (!req) return
  const lineIds = await approverLineIds(req.employee_id, req.current_approval_level)
  const empName = req.employee?.name || 'พนักงาน'
  const text = `🔔 มีคำขอ${type === 'ot' ? ' OT' : 'ลา'}ใหม่รออนุมัติ\n\n👤 ${empName}\n📄 ${describeRequest(type, req)}\n\nเปิดแอปเพื่ออนุมัติ`
  await Promise.all(lineIds.map(id => pushLine(id, text)))
}

// แจ้งผลเมื่อมีการตัดสิน (อนุมัติ/ปฏิเสธ) หรือส่งต่อ level ถัดไป
export async function notifyDecision(type: RequestType, requestId: string): Promise<void> {
  const req = await fetchRequest(type, requestId)
  if (!req) return
  const empLine = req.employee?.line_user_id as string | null
  const label = type === 'ot' ? 'คำขอ OT' : 'คำขอลา'
  const desc = describeRequest(type, req)

  if (req.status === 'rejected') {
    await pushLine(empLine, `❌ ${label}ของคุณไม่ได้รับอนุมัติ\n\n📄 ${desc}`)
  } else if (req.status === 'approved') {
    await pushLine(empLine, `✅ ${label}ของคุณได้รับอนุมัติแล้ว\n\n📄 ${desc}`)
  } else if (req.status === 'pending') {
    // ผ่าน level นี้แล้ว รอ level ถัดไป — แจ้งผู้อนุมัติคนถัดไป
    await notifyNewRequest(type, requestId)
  }
}

export type { RequestType }
