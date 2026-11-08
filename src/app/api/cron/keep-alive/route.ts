import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// keep-alive: เรียก Supabase เบาๆ เพื่อกัน free tier auto-pause (pause เมื่อไม่ใช้งาน 7 วัน)
// ตั้งให้รันทุก 3 วันผ่าน Vercel Cron — มีระยะเผื่อพอก่อนครบ 7 วัน

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  // ป้องกัน (Vercel Cron แนบ Authorization: Bearer <CRON_SECRET> ให้เอง ถ้าตั้งไว้)
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // query เบาสุด — แค่แตะ DB ให้นับเป็น activity
    const { error } = await supabase.from('employees').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ ok: true, ts: new Date().toISOString() })
  } catch (e) {
    console.error('keep-alive error:', e)
    return NextResponse.json({ ok: false, error: 'db unreachable' }, { status: 500 })
  }
}
