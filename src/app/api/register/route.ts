import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { auth } from '@/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // ต้องล็อกอิน LINE ก่อน — เอา line_user_id จาก session (ปลอมไม่ได้)
    const session = await auth()
    const lineUserId = session?.user?.lineUserId
    if (!lineUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ถ้าผูกกับระบบแล้ว ไม่ต้องลงทะเบียนซ้ำ
    if (session.user.employeeId || session.user.approverId) {
      return NextResponse.json({ alreadyRegistered: true })
    }

    const body = await request.json()
    const firstName = (body?.firstName || '').toString().trim()
    const lastName = (body?.lastName || '').toString().trim()
    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อและนามสกุล' }, { status: 400 })
    }

    const { error } = await supabase.from('registration_requests').upsert(
      {
        line_user_id: lineUserId,
        first_name: firstName,
        last_name: lastName,
        display_name: session.user.name || null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'line_user_id' }
    )

    if (error) {
      console.error('registration upsert error:', error)
      return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 })
    }

    // แจ้ง HR ทาง LINE ว่ามีคนลงทะเบียนใหม่ (best-effort)
    const token = process.env.LINE_MESSAGING_TOKEN
    const adminUserId = process.env.LINE_ADMIN_USER_ID
    if (token && adminUserId) {
      try {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            to: adminUserId,
            messages: [
              {
                type: 'text',
                text: `📝 มีพนักงานลงทะเบียนใหม่\n\n👤 ${firstName} ${lastName}\n🆔 ${lineUserId}\n\nเปิดเมนู จัดการระบบ > ผูก Line ID เพื่อผูกกับพนักงาน`,
              },
            ],
          }),
        })
      } catch (e) {
        console.error('notify admin register error:', e)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('register error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
