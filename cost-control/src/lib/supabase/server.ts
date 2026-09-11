import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// server client ใช้ใน Server Component และ Server Action (cookie session ผ่าน RLS)
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // เรียกจาก Server Component จะ set cookie ไม่ได้ proxy.ts จะ refresh session ให้แทน
          }
        },
      },
    }
  )
}
