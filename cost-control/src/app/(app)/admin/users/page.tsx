import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/app/common'
import { Alert } from '@/components/ui/alert'
import { AddUserDialog, UserRowActions } from '@/components/app/user-admin'
import { ROLE_HINTS, ROLE_LABELS, type UserRole } from '@/lib/types'
import { cn } from '@/lib/utils'

export default async function UsersPage() {
  const user = await requireUser()
  if (user.profile.role !== 'management' && user.profile.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, role, is_active').order('full_name')

  // อีเมลอยู่ใน Supabase Auth อ่านได้ด้วย service role เท่านั้น
  let auth = new Map<string, { email: string; selfRegistered: boolean; note: string | null }>()
  let adminReady = true
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 })
    auth = new Map(
      (data?.users ?? []).map(u => [
        u.id,
        { email: u.email ?? '', selfRegistered: u.user_metadata?.self_registered === true, note: (u.user_metadata?.signup_note as string | null) ?? null },
      ])
    )
  } catch {
    adminReady = false
  }
  // สมัครเองและยังไม่เปิดบัญชี ขึ้นก่อน
  const pending = (p: { id: string; is_active: boolean }) => !p.is_active && !!auth.get(p.id)?.selfRegistered
  const rows = [...(profiles ?? [])].sort((a, b) => Number(pending(b)) - Number(pending(a)))
  const pendingCount = rows.filter(pending).length
  const canGrantAdmin = user.profile.role === 'admin'

  return (
    <div className="max-w-3xl">
      <PageHeader title="ผู้ใช้และสิทธิ์" actions={adminReady ? <AddUserDialog canGrantAdmin={canGrantAdmin} /> : undefined} />
      {!adminReady && (
        <Alert tone="warning" className="mb-4">
          เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY จึงเพิ่มผู้ใช้จากหน้านี้ไม่ได้ ตั้งค่าใน Vercel (แบบ Sensitive) แล้ว redeploy
        </Alert>
      )}
      {pendingCount > 0 && (
        <Alert tone="info" className="mb-4">
          มีผู้สมัครใช้งานรอเปิดบัญชี {pendingCount} คน เลือกสิทธิ์ให้ถูกก่อน แล้วกด เปิดบัญชี
        </Alert>
      )}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {rows.map(p => (
          <div key={p.id} className={cn('px-4 py-3 space-y-2', !p.is_active && 'opacity-60')}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {p.full_name}
                  {p.id === user.id && <span className="text-xs text-muted-foreground font-normal"> (คุณ)</span>}
                  {pending(p) ? (
                    <span className="text-xs text-warning-fg font-normal"> สมัครเอง รอเปิดบัญชี</span>
                  ) : (
                    !p.is_active && <span className="text-xs text-danger-fg font-normal"> ปิดบัญชีแล้ว</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{auth.get(p.id)?.email ?? ''}</div>
                {pending(p) && auth.get(p.id)?.note && <div className="text-xs">ตำแหน่งที่แจ้ง: {auth.get(p.id)!.note}</div>}
              </div>
              <div className="text-xs text-muted-foreground">{ROLE_HINTS[p.role as UserRole]}</div>
            </div>
            {adminReady ? (
              <UserRowActions id={p.id} role={p.role as UserRole} isActive={p.is_active} isSelf={p.id === user.id} canGrantAdmin={canGrantAdmin} />
            ) : (
              <div className="text-sm">{ROLE_LABELS[p.role as UserRole]}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
