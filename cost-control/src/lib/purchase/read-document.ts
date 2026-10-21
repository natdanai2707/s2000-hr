import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeObjectName } from '@/lib/storage'
import { fail, type ActionResult } from '@/actions/types'
import { extractPurchaseDocument, matchLinesToBoq, type ExtractedDoc } from './extract'
import { matchProjectByJob } from './job'
import { reviewExtraction } from './review'
import type { PurchaseDocumentResult } from './document-types'

export const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const
type DocType = (typeof DOC_TYPES)[number]

// อ่านเอกสารจัดซื้อหนึ่งใบ: Claude อ่านรายการและเลขงาน (JOB) โค้ดเลือกโครงการจากเลขงาน ตรวจตัวเลข และแนบไฟล์ไว้กับโครงการ
// projectId ว่าง = ให้ระบบหาโครงการจาก candidateIds ถ้าหาไม่ได้ คืนเอกสารที่อ่านแล้ว (unassigned_doc) ให้ผู้ใช้เลือกโครงการ
// doc = เอกสารที่อ่านไว้แล้ว ส่งกลับมาพร้อมโครงการที่ผู้ใช้เลือก จับคู่ BOQ ต่อโดยไม่ให้ Claude อ่านรูปซ้ำ
export async function readPurchaseDocument(
  supabase: SupabaseClient,
  input: { file: File; projectId: string | null; candidateIds: string[]; doc: ExtractedDoc | null }
): Promise<ActionResult<PurchaseDocumentResult>> {
  const { file, projectId } = input
  if (file.size === 0) return fail('กรุณาเลือกรูปหรือไฟล์ PDF')
  if (!(DOC_TYPES as readonly string[]).includes(file.type)) return fail('รองรับรูป JPG PNG WEBP และไฟล์ PDF')
  if (file.size > 4 * 1024 * 1024) return fail('ไฟล์ใหญ่เกิน 4MB')
  if (input.doc && !projectId) return fail('กรุณาเลือกโครงการ')

  const ids = [...new Set([...(projectId ? [projectId] : []), ...input.candidateIds])].slice(0, 300)
  const { data: summaries } = ids.length
    ? await supabase.from('v_project_summary').select('project_id, code, name, confirmed_version_id').in('project_id', ids).not('confirmed_version_id', 'is', null)
    : { data: [] }
  const projects = (summaries ?? []).map(p => ({ id: p.project_id as string, code: p.code as string, name: p.name as string, version: p.confirmed_version_id as string }))
  if (projectId && !projects.some(p => p.id === projectId)) return fail('โครงการนี้ยังไม่มี BOQ ที่ยืนยัน')
  if (projects.length === 0) return fail('ไม่มีโครงการที่มี BOQ ยืนยันแล้ว')
  const label = (id: string) => {
    const p = projects.find(x => x.id === id)!
    return `${p.code} ${p.name}`
  }

  const loadBoq = async (id: string) => {
    const { data } = await supabase
      .from('boq_items')
      .select('id, description, unit')
      .eq('boq_version_id', projects.find(p => p.id === id)!.version)
      .gte('qty', 0)
      .order('sort_order')
    return (data ?? []) as { id: string; description: string; unit: string | null }[]
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
  const upload = async (id: string): Promise<string | { ok: false; error: string }> => {
    const path = `projects/${id}/purchases/${safeObjectName(file.name || `document.${ext}`, ext)}`
    const { error } = await supabase.storage.from('project-files').upload(path, buffer, { contentType: file.type })
    return error ? fail(`อัปโหลดไฟล์ไม่สำเร็จ: ${error.message}`) : path
  }
  const base = (doc: ExtractedDoc | null): PurchaseDocumentResult => ({
    project_id: null, job_reference: doc?.job_reference ?? null, attachment_path: null, read_error: null,
    supplier_name: doc?.supplier_name ?? null, document_no: doc?.document_no ?? null, document_date: doc?.document_date ?? null,
    grand_total: doc?.grand_total ?? null, total_excl_vat: null, lines: [], issues: [], notes: [], warnings: [], unassigned_doc: null,
  })

  // รู้โครงการแล้ว: จับคู่ BOQ (ถ้ายังไม่ได้จับ) แนบไฟล์ และตรวจตัวเลข
  const finish = async (id: string, doc: ExtractedDoc, opts: { match: boolean; notes: string[]; warnings: string[] }): Promise<ActionResult<PurchaseDocumentResult>> => {
    const boq = await loadBoq(id)
    const warnings = [...opts.warnings]
    if (opts.match) {
      for (const l of doc.lines) Object.assign(l, { boq_index: null, qty_factor: null })
      const match = await matchLinesToBoq(doc.lines, boq)
      if (match.status === 'ok') {
        for (const m of match.matches) {
          const line = doc.lines[m.line_index]
          if (line) Object.assign(line, { boq_index: m.boq_index, qty_factor: m.qty_factor, match_note: m.match_note })
        }
      } else {
        warnings.push('จับคู่รายการกับ BOQ ไม่สำเร็จ เลือกรายการ BOQ เองทุกบรรทัด')
      }
    }
    const path = await upload(id)
    if (typeof path !== 'string') return path
    const review = reviewExtraction(doc, boq)
    return {
      ok: true,
      data: {
        ...base(doc),
        project_id: id,
        attachment_path: path,
        total_excl_vat: review.total_excl_vat,
        lines: review.lines,
        issues: review.issues,
        notes: [...opts.notes, ...review.notes],
        warnings: [...warnings, ...doc.warnings].slice(0, 5),
      },
    }
  }

  if (input.doc) return finish(projectId!, input.doc, { match: true, notes: [], warnings: [] })

  // อ่านไม่ได้: ถ้ารู้โครงการ แนบไฟล์ไว้ให้กรอกเอง ถ้าไม่รู้ ให้เลือกโครงการแล้วอ่านใหม่
  const unread = async (message: string): Promise<ActionResult<PurchaseDocumentResult>> => {
    if (!projectId) return fail(message)
    const path = await upload(projectId)
    if (typeof path !== 'string') return path
    return { ok: true, data: { ...base(null), project_id: projectId, attachment_path: path, read_error: message } }
  }

  const outcome = await extractPurchaseDocument({ data: buffer.toString('base64'), mediaType: file.type as DocType }, projectId ? await loadBoq(projectId) : [], projects)
  if (outcome.status === 'off') return unread('ระบบยังเรียก Claude ไม่ได้ เพราะไม่พบ ANTHROPIC_API_KEY บนเซิร์ฟเวอร์')
  if (outcome.status === 'failed') return unread(`เรียก Claude ไม่สำเร็จ (${outcome.reason})`)
  const doc = outcome.doc
  if (!doc.is_purchase_document || doc.lines.length === 0) {
    return unread('ไม่พบรายการสินค้าในเอกสารนี้ ตรวจว่าเป็นใบสั่งซื้อ ใบกำกับภาษี หรือใบเสร็จ และรูปชัดพอ')
  }

  // โค้ดเทียบเลขงานกับรหัสและชื่อโครงการก่อน ถ้าไม่เจอจึงใช้โครงการที่ Claude เลือกจากชื่องาน
  const byJob = matchProjectByJob(doc.job_reference, projects)
  const byClaude = doc.project_index !== null && doc.project_index >= 0 && doc.project_index < projects.length ? projects[doc.project_index].id : null
  const detected = byJob ?? byClaude

  if (projectId) {
    const warnings =
      detected && detected !== projectId
        ? [`เลขงานในเอกสาร${doc.job_reference ? ` ${doc.job_reference}` : ''} ตรงกับโครงการ ${label(detected)} ไม่ใช่โครงการที่เลือก ตรวจว่าเลือกโครงการถูก`]
        : []
    return finish(projectId, doc, { match: false, notes: [], warnings })
  }
  if (!detected) {
    return {
      ok: true,
      data: {
        ...base(doc),
        unassigned_doc: doc,
        warnings: [`ไม่พบโครงการที่ตรงกับเลขงานในเอกสาร${doc.job_reference ? ` (${doc.job_reference})` : ''} เลือกโครงการเพื่อจับคู่รายการกับ BOQ`],
      },
    }
  }
  const note = byJob
    ? `เลือกโครงการ ${label(detected)} จากเลขงาน ${doc.job_reference}`
    : `Claude เลือกโครงการ ${label(detected)} จากชื่องานในเอกสาร ตรวจว่าถูกโครงการก่อนบันทึก`
  return finish(detected, doc, { match: true, notes: [note], warnings: [] })
}
