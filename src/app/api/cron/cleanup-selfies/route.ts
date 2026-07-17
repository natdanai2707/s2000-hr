import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ลบรูป selfie ที่เก่ากว่า N เดือน (ค่าเริ่มต้น 2 เดือน) เพื่อประหยัดพื้นที่ Supabase
// ทำงานผ่าน Vercel Cron (เดือนละครั้ง) หรือเรียกเองด้วย ?months=

const BUCKET = 'attendance-selfies'
const DEFAULT_MONTHS = 2
const URL_MARKER = `/${BUCKET}/`

export async function GET(request: NextRequest) {
  // ป้องกัน: ต้องมี CRON_SECRET (Vercel Cron จะแนบ Authorization: Bearer <CRON_SECRET> ให้เอง)
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) {
    return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY / URL' }, { status: 500 })
  }

  // service role — ข้าม RLS เพื่อลบไฟล์ storage ได้
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { searchParams } = new URL(request.url)
  const months = parseInt(searchParams.get('months') || '') || DEFAULT_MONTHS

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffISO = cutoff.toISOString()

  try {
    // หา log ที่มีรูป และเช็คอินเก่ากว่า cutoff
    const { data: rows, error } = await supabase
      .from('attendance_logs')
      .select('id, selfie_url')
      .not('selfie_url', 'is', null)
      .lt('check_in', cutoffISO)
    if (error) throw error

    const paths: string[] = []
    const ids: string[] = []
    for (const row of rows || []) {
      const u = row.selfie_url as string
      const idx = u.indexOf(URL_MARKER)
      if (idx >= 0) {
        paths.push(u.slice(idx + URL_MARKER.length))
        ids.push(row.id)
      }
    }

    if (paths.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, cutoff: cutoffISO })
    }

    // ลบไฟล์ทีละก้อน (chunk 100) แล้วล้าง selfie_url
    let deleted = 0
    for (let i = 0; i < paths.length; i += 100) {
      const chunkPaths = paths.slice(i, i + 100)
      const chunkIds = ids.slice(i, i + 100)
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(chunkPaths)
      if (rmErr) {
        console.error('storage remove error:', rmErr)
        continue
      }
      await supabase.from('attendance_logs').update({ selfie_url: null }).in('id', chunkIds)
      deleted += chunkPaths.length
    }

    return NextResponse.json({ success: true, deleted, cutoff: cutoffISO })
  } catch (e) {
    console.error('cleanup selfies error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
