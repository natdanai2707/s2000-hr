import { NextResponse } from 'next/server'

// ตรวจสุขภาพและวัดเวลาไปกลับจากเซิร์ฟเวอร์นี้ถึง Supabase ใช้เลือกภูมิภาคของเซิร์ฟเวอร์ให้ใกล้ฐานข้อมูล
// คืนเฉพาะภูมิภาคและตัวเลขเวลา ไม่มีข้อมูลผู้ใช้หรือข้อมูลธุรกิจ
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const ms: number[] = []
  let ok = false
  if (url && key) {
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      try {
        const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store' })
        ok = res.ok
      } catch {
        ok = false
      }
      ms.push(Math.round(performance.now() - t))
    }
  }
  return NextResponse.json({ ok, region: process.env.VERCEL_REGION ?? null, supabase_rtt_ms: ms })
}
