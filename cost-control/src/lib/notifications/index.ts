import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendLine } from './line'

// notification service แบบ pluggable: in-app (ตาราง notifications) และ LINE
// เหตุการณ์: pr_pending, pr_decided, goods_received, project_warning, invoice_due

export type NotificationEvent =
  | 'pr_pending'
  | 'pr_decided'
  | 'goods_received'
  | 'project_warning'
  | 'invoice_due'

export interface NotificationPayload {
  event: NotificationEvent
  userIds: string[]
  title: string
  body?: string
  link?: string
}

export interface NotificationChannel {
  name: string
  send(payload: NotificationPayload, profiles: { id: string; line_user_id: string | null }[]): Promise<void>
}

const inAppChannel: NotificationChannel = {
  name: 'in-app',
  async send(payload, profiles) {
    if (profiles.length === 0) return
    const admin = createAdminClient()
    const rows = profiles.map(p => ({
      user_id: p.id,
      event: payload.event,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
    }))
    const { error } = await admin.from('notifications').insert(rows)
    if (error) console.error('in-app notification failed:', error.message)
  },
}

const lineChannel: NotificationChannel = {
  name: 'line',
  async send(payload, profiles) {
    const text = payload.body ? `${payload.title}\n${payload.body}` : payload.title
    await Promise.all(profiles.filter(p => p.line_user_id).map(p => sendLine(p.line_user_id!, text)))
  },
}

const channels: NotificationChannel[] = [inAppChannel, lineChannel]

export async function notify(payload: NotificationPayload): Promise<void> {
  const ids = [...new Set(payload.userIds)].filter(Boolean)
  if (ids.length === 0) return
  try {
    const admin = createAdminClient()
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, line_user_id')
      .in('id', ids)
      .eq('is_active', true)
    await Promise.all(channels.map(c => c.send(payload, profiles ?? [])))
  } catch (e) {
    // notification ห้ามทำให้ธุรกรรมหลักล้ม
    console.error('notify failed:', e)
  }
}

// ผู้อนุมัติของ PR ตามสถานะ: pending_pm -> PM ของโครงการ (+management), pending_management -> management ทุกคน
export async function approverIdsFor(projectId: string, status: 'pending_pm' | 'pending_management'): Promise<string[]> {
  const admin = createAdminClient()
  const { data: mgmt } = await admin.from('profiles').select('id').eq('role', 'management').eq('is_active', true)
  const ids = (mgmt ?? []).map(m => m.id)
  if (status === 'pending_pm') {
    const { data: members } = await admin
      .from('project_members')
      .select('user_id, profiles!inner(role)')
      .eq('project_id', projectId)
      .eq('profiles.role', 'project_manager')
    ids.push(...(members ?? []).map(m => m.user_id))
  }
  return ids
}
