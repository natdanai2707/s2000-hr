import 'server-only'
import { createClient } from '@supabase/supabase-js'

// service-role client ข้าม RLS ใช้เฉพาะงานที่ระบบทำแทนผู้ใช้ (notification, cron, seed)
// ห้าม import จาก client component
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('ไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
