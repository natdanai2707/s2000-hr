import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseExtractedDoc } from '@/lib/purchase/extract'
import { readPurchaseDocument } from '@/lib/purchase/read-document'

// อ่านเอกสารจัดซื้อผ่าน Route Handler ไม่ใช่ Server Action เพราะ Server Action ถูกส่งทีละคำขอ
// แนบหลายใบพร้อมกันจะอ่านได้ทีละใบ และปุ่มบันทึกต้องรอการอ่านที่ค้างอยู่ทั้งหมด
export const maxDuration = 300

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })

  const fd = await request.formData()
  const file = fd.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'กรุณาเลือกรูปหรือไฟล์ PDF' })
  let candidateIds: string[] = []
  let doc = null
  try {
    const ids = JSON.parse(String(fd.get('candidate_ids') ?? '[]'))
    if (Array.isArray(ids)) candidateIds = ids.filter((x): x is string => typeof x === 'string')
    const rawDoc = fd.get('doc')
    if (typeof rawDoc === 'string' && rawDoc) {
      doc = parseExtractedDoc(JSON.parse(rawDoc))
      if (!doc) return NextResponse.json({ ok: false, error: 'ข้อมูลเอกสารไม่ถูกต้อง อ่านใหม่อีกครั้ง' })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' })
  }
  const projectId = String(fd.get('project_id') ?? '') || null
  return NextResponse.json(await readPurchaseDocument(supabase, { file, projectId, candidateIds, doc }))
}
