import { AppShell } from '@/components/app/app-shell'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const supabase = await createClient()
  const [{ data: pending }, { count: unread }] = await Promise.all([
    supabase.rpc('pending_approval_count'),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
  ])
  return (
    <AppShell profile={user.profile} pendingCount={Number(pending ?? 0)} unreadCount={unread ?? 0}>
      {children}
    </AppShell>
  )
}
