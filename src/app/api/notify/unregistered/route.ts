import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { lineUserId, displayName } = await request.json()

    const token = process.env.LINE_MESSAGING_TOKEN
    const adminUserId = process.env.LINE_ADMIN_USER_ID

    if (!token || !adminUserId || !lineUserId) {
      return NextResponse.json({ error: 'Missing config' }, { status: 500 })
    }

    // กัน spam: เช็คว่าเคยแจ้งเตือน user นี้ไปแล้วหรือยัง
    const { data: existing } = await supabase
      .from('notified_users')
      .select('line_user_id')
      .eq('line_user_id', lineUserId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ success: true, skipped: true })
    }

    // บันทึกว่าแจ้งแล้ว
    await supabase.from('notified_users').insert({ line_user_id: lineUserId })

    const message = {
      to: adminUserId,
      messages: [
        {
          type: 'text',
          text: `🔔 มีพนักงานใหม่เข้าระบบ\n\n👤 ชื่อ Line: ${displayName || 'ไม่ทราบชื่อ'}\n🆔 Line ID:\n${lineUserId}\n\nกรุณาเพิ่ม Line ID ในตาราง employees เพื่อให้เข้าใช้งานได้`,
        },
      ],
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(message),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('LINE API error:', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Notify error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}