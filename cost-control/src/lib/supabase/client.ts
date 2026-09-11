'use client'

import { createBrowserClient } from '@supabase/ssr'

// browser client ใช้ใน client component (ผ่าน RLS ตามผู้ใช้ที่ login)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
