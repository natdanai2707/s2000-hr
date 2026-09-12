import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/app/common'
import { formatThaiDateTime } from '@/lib/date'
import { markAllNotificationsRead, markNotificationRead } from '@/actions/notifications'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function NotificationsPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: rows } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
  const unread = (rows ?? []).filter(r => !r.read_at).length
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="แจ้งเตือน"
        subtitle={unread ? `ยังไม่อ่าน ${unread} รายการ` : undefined}
        actions={unread > 0 ? <form action={markAllNotificationsRead}><Button type="submit" variant="outline">อ่านทั้งหมด</Button></form> : undefined}
      />
      {!rows?.length ? (
        <EmptyState title="ยังไม่มีการแจ้งเตือน" />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {rows.map(n => (
            <div key={n.id} className={cn('px-4 py-3 flex items-start justify-between gap-3', !n.read_at && 'bg-primary/5')}>
              <div className="min-w-0">
                <div className={cn('text-sm', !n.read_at && 'font-medium')}>{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                <div className="text-xs text-muted-foreground mt-0.5">{formatThaiDateTime(n.created_at)}</div>
              </div>
              {!n.read_at && (
                <form action={markNotificationRead.bind(null, n.id)}>
                  <Button type="submit" size="sm" variant="ghost">อ่านแล้ว</Button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
