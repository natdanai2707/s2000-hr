'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'

export async function markNotificationRead(id: string) {
  const user = await requireUser()
  const supabase = await createClient()
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
  revalidatePath('/notifications')
}

export async function markAllNotificationsRead() {
  const user = await requireUser()
  const supabase = await createClient()
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null)
  revalidatePath('/notifications')
}
