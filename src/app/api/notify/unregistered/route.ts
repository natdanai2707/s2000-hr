import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { lineUserId, displayName, pictureUrl } = await request.json()

    const token = process.env.LINE_MESSAGING_TOKEN
    const adminUserId = process.env.LINE_ADMIN_USER_ID

    if (!token || !adminUserId) {
      return NextResponse.json({ error: 'Missing config' }, { status: 500 })
    }

    const message = {
      to: adminUserId,
      messages: [
        {
          type: 'text',
          text: `🔔 มีพนักงานใหม่เข้าระบบ\n\n👤 ชื่อ: ${displayName || 'ไม่ทราบชื่อ'}\n🆔 Line ID: ${lineUserId}\n\nกรุณาเพิ่ม Line ID ในตาราง employees หรือ approvers เพื่อให้เข้าใช้งานได้`,
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