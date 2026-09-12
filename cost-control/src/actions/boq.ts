'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { parseWorkbook } from '@/lib/boq/parse'
import { autoDetectMapping, splitRows, type ColumnMapping } from '@/lib/boq/split'
import type { BoqVersionType } from '@/lib/types'
import { fail, type ActionResult } from './types'

export interface UploadPreviewSheet {
  name: string
  headers: string[]
  preview: unknown[][]
  row_count: number
  mapping: ColumnMapping
  mapping_from_template: boolean
}

export interface UploadPreviewResult {
  file_path: string
  sheets: UploadPreviewSheet[]
}

// ขั้นที่ 1: อัปโหลดไฟล์ เก็บใน storage อ่านตัวอย่าง 20 แถวต่อชีต และเสนอ mapping (จาก template ถ้ามี)
export async function uploadBoqPreview(projectId: string, fd: FormData): Promise<ActionResult<UploadPreviewResult>> {
  const user = await requireUser()
  const supabase = await createClient()
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return fail('กรุณาเลือกไฟล์ .xlsx')
  if (!file.name.toLowerCase().endsWith('.xlsx')) return fail('รองรับเฉพาะไฟล์ .xlsx')

  const buffer = Buffer.from(await file.arrayBuffer())
  let sheets
  try {
    sheets = await parseWorkbook(buffer)
  } catch {
    return fail('อ่านไฟล์ไม่ได้ ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง')
  }
  if (sheets.length === 0) return fail('ไม่พบข้อมูลในไฟล์')

  const path = `projects/${projectId}/boq/${Date.now()}-${file.name.replace(/[^\w.\-ก-๙]/g, '_')}`
  const { error: upErr } = await supabase.storage.from('project-files').upload(path, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })
  if (upErr) return fail(`อัปโหลดไฟล์ไม่สำเร็จ: ${upErr.message}`)

  const { data: templates } = await supabase
    .from('boq_import_templates')
    .select('sheet_name, mapping')
    .in('sheet_name', sheets.map(s => s.name))
  const templateMap = new Map((templates ?? []).map(t => [t.sheet_name, t.mapping as ColumnMapping]))

  return {
    ok: true,
    data: {
      file_path: path,
      sheets: sheets.map(s => {
        const tpl = templateMap.get(s.name)
        return {
          name: s.name,
          headers: s.headers.map(h => (h === null || h === undefined ? '' : String(h))),
          preview: s.preview,
          row_count: s.rows.length,
          mapping: tpl ?? autoDetectMapping(s.headers),
          mapping_from_template: !!tpl,
        }
      }),
    },
  }
  void user
}

export interface ImportSheetInput {
  name: string
  mapping: ColumnMapping
  include: boolean
}

// ขั้นที่ 2: นำเข้าเป็น boq_version ใหม่ (quotation หรือ VO) บันทึก mapping เป็น template ตามชื่อชีต
export async function importBoq(
  projectId: string,
  filePath: string,
  type: BoqVersionType,
  sheets: ImportSheetInput[],
  defaultMarkupPct: number,
  note: string
): Promise<ActionResult<{ version_id: string }>> {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: fileData, error: dlErr } = await supabase.storage.from('project-files').download(filePath)
  if (dlErr || !fileData) return fail('ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่')
  const parsed = await parseWorkbook(Buffer.from(await fileData.arrayBuffer()))

  const { data: existing } = await supabase
    .from('boq_versions')
    .select('version_no')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
  const nextNo = (existing?.[0]?.version_no ?? 0) + 1

  let versionId: string
  if (type === 'variation_order') {
    // VO: copy รายการจาก version ที่ยืนยันแล้ว จากนั้นเติมรายการจากไฟล์ (ถ้ามี)
    const { data, error } = await supabase.rpc('create_variation_order', { p_project_id: projectId, p_note: note || null })
    if (error) return fail(error)
    versionId = data as string
    await supabase.from('boq_versions').update({ source_file_path: filePath }).eq('id', versionId)
  } else {
    const { data, error } = await supabase
      .from('boq_versions')
      .insert({ project_id: projectId, version_no: nextNo, type: 'quotation', status: 'draft', source_file_path: filePath, note: note || null, created_by: user.id })
      .select('id')
      .single()
    if (error) return fail(error)
    versionId = data.id
  }

  let sectionOffset = 0
  let itemOffset = 0
  let totalItems = 0
  for (const sheetInput of sheets) {
    if (!sheetInput.include) continue
    const sheet = parsed.find(s => s.name === sheetInput.name)
    if (!sheet) continue
    const result = splitRows(sheet.rows, sheetInput.mapping, defaultMarkupPct)
    if (result.items.length === 0) continue

    // ชีตเดียวมีหลายหมวด: ถ้าชีตไม่มีหัวข้อหมวดเลย ใช้ชื่อชีตเป็นหมวด
    const sectionsToInsert = result.sections.length > 0 ? result.sections : [{ code: null, name: sheet.name, sort_order: 0 }]
    const { data: secRows, error: secErr } = await supabase
      .from('boq_sections')
      .insert(sectionsToInsert.map(s => ({ boq_version_id: versionId, code: s.code, name: s.name, sort_order: sectionOffset + s.sort_order, created_by: user.id })))
      .select('id')
    if (secErr) return fail(secErr)
    const sectionIds = (secRows ?? []).map(r => r.id)
    sectionOffset += sectionsToInsert.length

    const rows = result.items.map(it => ({
      boq_version_id: versionId,
      section_id: result.sections.length > 0 ? (it.section_index === null ? null : sectionIds[it.section_index]) : sectionIds[0],
      item_no: it.item_no,
      description: it.description,
      unit: it.unit,
      qty: it.qty,
      unit_cost: it.unit_cost,
      category: it.category,
      markup_pct: it.markup_pct,
      sell_unit_price: it.sell_unit_price,
      sort_order: itemOffset + it.sort_order,
      created_by: user.id,
    }))
    itemOffset += result.items.length
    totalItems += result.items.length
    const { error: itemErr } = await supabase.from('boq_items').insert(rows)
    if (itemErr) return fail(itemErr)

    // บันทึก template ตามชื่อชีต ครั้งถัดไปนำเข้าอัตโนมัติ
    await supabase
      .from('boq_import_templates')
      .upsert({ sheet_name: sheetInput.name, mapping: sheetInput.mapping, created_by: user.id }, { onConflict: 'sheet_name' })
  }

  if (totalItems === 0 && type !== 'variation_order') {
    await supabase.from('boq_versions').delete().eq('id', versionId)
    return fail('ไม่พบรายการที่นำเข้าได้ ตรวจสอบการจับคู่คอลัมน์')
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true, data: { version_id: versionId } }
}

export async function confirmBoqVersion(versionId: string, projectId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_boq_version', { p_version_id: versionId })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { ok: true, data: undefined }
}

export async function createVariationOrder(projectId: string, note: string): Promise<ActionResult<{ version_id: string }>> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_variation_order', { p_project_id: projectId, p_note: note || null })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, data: { version_id: data as string } }
}

export interface BoqItemInput {
  section_id: string | null
  item_no: string
  description: string
  unit: string
  qty: number
  unit_cost: number
  category: string
  markup_pct: number
}

export async function saveBoqItem(versionId: string, projectId: string, itemId: string | null, input: BoqItemInput): Promise<ActionResult> {
  const user = await requireUser()
  const supabase = await createClient()
  const sell = Math.round(input.unit_cost * (1 + input.markup_pct / 100) * 100) / 100
  const row = {
    section_id: input.section_id,
    item_no: input.item_no || null,
    description: input.description,
    unit: input.unit || null,
    qty: input.qty,
    unit_cost: input.unit_cost,
    category: input.category,
    markup_pct: input.markup_pct,
    sell_unit_price: sell,
  }
  if (!input.description) return fail('กรุณากรอกรายละเอียด')
  const { error } = itemId
    ? await supabase.from('boq_items').update(row).eq('id', itemId)
    : await supabase.from('boq_items').insert({ ...row, boq_version_id: versionId, sort_order: 100000, created_by: user.id })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}/boq/${versionId}`)
  return { ok: true, data: undefined }
}

export async function deleteBoqItem(versionId: string, projectId: string, itemId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('boq_items').delete().eq('id', itemId)
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}/boq/${versionId}`)
  return { ok: true, data: undefined }
}
