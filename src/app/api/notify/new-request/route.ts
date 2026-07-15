import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { notifyNewRequest, RequestType } from '@/lib/line'

export async function POST(request: NextRequest) {
  try {
    // ต้องล็อกอินก่อน (กันการยิงมั่ว)
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, requestId } = await request.json()
    if ((type !== 'leave' && type !== 'ot') || !requestId) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    await notifyNewRequest(type as RequestType, requestId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('notify new-request error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
