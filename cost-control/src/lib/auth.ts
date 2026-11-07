import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, Settings, UserRole } from '@/lib/types'
import { DEFAULT_SETTINGS } from '@/lib/types'

export interface CurrentUser {
  id: string
  email: string | null
  profile: Profile
}

// อ่านผู้ใช้ปัจจุบันจาก session ถ้าไม่มี redirect ไป login
// cache ต่อหนึ่ง request: layout และ page เรียกซ้ำได้โดยไม่ถามเซิร์ฟเวอร์ซ้ำ
// getClaims ตรวจลายเซ็น JWT ในเครื่องได้ (คีย์แบบ asymmetric) ไม่ต้องถาม Auth server ทุกครั้งเหมือน getUser
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', claims.sub).maybeSingle()
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut()
    redirect('/login?error=inactive')
  }
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null, profile: profile as Profile }
})

export function hasRole(profile: Profile, roles: UserRole[]): boolean {
  return roles.includes(profile.role)
}

export async function requireRole(roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser()
  if (!hasRole(user.profile, roles)) redirect('/?error=forbidden')
  return user
}

export const loadSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient()
  const { data } = await supabase.from('settings').select('key, value')
  const out: Settings = { ...DEFAULT_SETTINGS }
  for (const row of data ?? []) {
    if (row.key === 'price_variance_threshold_pct') out.price_variance_threshold_pct = Number(row.value)
    if (row.key === 'pm_approval_limit') out.pm_approval_limit = Number(row.value)
    if (row.key === 'qty_over_boq_requires_management') out.qty_over_boq_requires_management = Boolean(row.value)
    if (row.key === 'direct_purchase_mode') out.direct_purchase_mode = row.value === true
  }
  return out
})
