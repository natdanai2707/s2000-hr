import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, date, location, inTime, outTime } = await request.json()

    const token = process.env.LINE_MESSAGING_TOKEN
    const adminUserId = process.env.LINE_ADMIN_USER_ID
    if (!token || !adminUserId) {
      // ไม่มี config ก็ถือว่าไม่ต้องแจ้ง (ไม่ให้ล้ม)
      return NextResponse.json({ success: true, skipped: true })
    }

    const timeText = outTime ? `${inTime} - ${outTime}` : `${inTime} (ยังไม่เช็คเอาท์)`
    const text = `⚠️ บันทึกเวลาย้อนหลัง (นอกพื้นที่)\n\n👤 ${name || 'พนักงาน'}\n📅 ${date}\n🕐 ${timeText}\n📍 ${location}\n\nเป็นการกรอกเองภายหลัง ไม่ได้เช็คอินในพื้นที่ที่กำหนด กรุณาตรวจสอบ`

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: adminUserId, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      console.error('manual attendance notify failed:', await res.text())
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('manual attendance notify error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
