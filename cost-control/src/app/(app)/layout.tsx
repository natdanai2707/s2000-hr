import { AppShell } from '@/components/app/app-shell'
import { requireUser, loadSettings } from '@/lib/auth'
import { usesDirectPurchase } from '@/lib/types'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const supabase = await createClient()
  const [settings, { data: pending }, { count: unread }] = await Promise.all([
    loadSettings(),
    supabase.rpc('pending_approval_count'),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
  ])
  return (
    <AppShell profile={user.profile} pendingCount={Number(pending ?? 0)} unreadCount={unread ?? 0} directMode={usesDirectPurchase(settings, user.profile.role)}>
      {children}
    </AppShell>
  )
}
