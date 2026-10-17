'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { readSheets, detectLayout, buildPreview } from '@/lib/boq/parse'
import { splitRows, type ColumnMapping } from '@/lib/boq/split'
import { analyzeSheet } from '@/lib/boq/analyze'
import { verifySheet, type CheckIssue, type ContractCandidate } from '@/lib/boq/verify'
import { readStoredTemplate, type SheetLayout } from '@/lib/boq/layout'
import { chooseLayout, templateHeaders } from '@/lib/boq/choose'
import { safeObjectName } from '@/lib/storage'
import type { BoqVersionType } from '@/lib/types'
import { fail, type ActionResult } from './types'

export interface UploadPreviewSheet {
  name: string
  headers: string[]
  preview: unknown[][]
  row_count: number
  header_rows: number
  mapping: ColumnMapping
  layout: SheetLayout
  // ที่มาของการจับคู่คอลัมน์: template ที่เคยบันทึก, Claude อ่านให้, หรือกฎตายตัวเป็นทางสำรอง
  mapping_source: 'template' | 'ai' | 'rules'
  ai_confidence: 'high' | 'medium' | 'low' | null
  ai_warnings: string[]
  // ผลลองแตกรายการทั้งชีตด้วย mapping ที่เสนอ ใช้ตัดสินว่าชีตนี้ควรนำเข้าหรือไม่
  item_count: number
  section_count: number
  cost_total: number
  sell_total: number
  // ใช้ต้นทุนจากคอลัมน์ต้นทุนของผู้ประมาณราคา ราคาในตารางเป็นราคาขาย
  cost_mode: boolean
  missing_cost_items: number
  suggested: boolean
  deduction_headings: string[]
  deduction_items: number
  markup_column_rejected: boolean
  // สถานะการอ่านด้วย Claude: used = ใช้ผลของ Claude, unused = Claude อ่านแล้วแต่ใช้ template หรือกฎแทน,
  // off = ไม่ได้ตั้ง ANTHROPIC_API_KEY, failed = ตั้งแล้วแต่เรียกไม่สำเร็จ
  ai_status: 'used' | 'unused' | 'off' | 'failed'
  ai_error: string | null
  // ผลตรวจตัวเลขที่คำนวณไว้ในไฟล์
  check_count: number
  check_issues: CheckIssue[]
  // ชีตรายละเอียด BOQ หรือไม่ ใช้เลือกมูลค่าสัญญา
  is_detail: boolean
  contract: ContractCandidate | null
}

export interface UploadPreviewResult {
  file_path: string
  file_name: string
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
  let raw
  try {
    raw = await readSheets(buffer)
  } catch {
    return fail('อ่านไฟล์ไม่ได้ ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง')
  }
  raw = raw.filter(s => s.grid.some(r => r.some(c => c !== null && c !== '')))
  if (raw.length === 0) return fail('ไม่พบข้อมูลในไฟล์')

  // ชื่อไฟล์ใน Storage ต้องเป็น ASCII ชื่อเดิม (เช่น ภาษาไทย) เก็บไว้ในคอลัมน์ source_file_name
  const path = `projects/${projectId}/boq/${safeObjectName(file.name, 'xlsx')}`
  const { error: upErr } = await supabase.storage.from('project-files').upload(path, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })
  if (upErr) return fail(`อัปโหลดไฟล์ไม่สำเร็จ: ${upErr.message}`)

  const { data: templates } = await supabase
    .from('boq_import_templates')
    .select('sheet_name, mapping')
    .in('sheet_name', raw.map(s => s.name))
  const templateMap = new Map<string, NonNullable<ReturnType<typeof readStoredTemplate>>>()
  for (const t of templates ?? []) {
    const parsed = readStoredTemplate(t.mapping)
    if (parsed) templateMap.set(t.sheet_name, parsed)
  }

  // Claude อ่านโครงทุกชีต (ขนานกัน) แม้ชีตนั้นจะมี template เพราะชื่อชีตซ้ำกันข้ามไฟล์ได้ (เช่น BOQ)
  // ถ้าไม่ได้ตั้ง ANTHROPIC_API_KEY หรือเรียกไม่สำเร็จ ตกไปใช้กฎตายตัวเหมือนเดิม
  const ANALYZE_LIMIT = 8
  const analyses = await Promise.all(
    raw.map(async (sheet, idx) => {
      if (idx >= ANALYZE_LIMIT) return { status: 'failed', reason: `อ่านด้วย Claude ได้ไม่เกิน ${ANALYZE_LIMIT} ชีตต่อไฟล์` } as const
      return analyzeSheet(sheet.name, sheet.grid)
    })
  )

  const sheets: UploadPreviewSheet[] = raw.map((sheet, idx) => {
    const outcome = analyses[idx]
    const ai = outcome.status === 'ok' ? outcome.result : null
    const chosen = chooseLayout(sheet.name, sheet.grid, templateMap.get(sheet.name) ?? null, ai)
    const { layout, mapping, preview, split } = chosen
    const source = chosen.source
    const cost = split.items.reduce((sum, i) => sum + i.qty * i.unit_cost, 0)
    const sell = split.items.reduce((sum, i) => sum + i.qty * i.sell_unit_price, 0)
    // ชีตที่มีคอลัมน์ราคาวัสดุหรือค่าแรงคือชีต BOQ จริง
    // ส่วนชีตปกและใบเสนอราคามีแต่ยอดรวม ถ้านำเข้าด้วยจะนับต้นทุนซ้ำ
    const hasPriceColumns = mapping.material_price != null || mapping.labor_price != null
    const suggested = ai ? ai.is_boq_detail_sheet && split.items.length > 0 : split.items.length > 0 && hasPriceColumns
    const check = verifySheet(sheet.grid, layout, mapping, { roles: ai?.roles, contractCell: ai?.contract_cell ?? null })

    return {
      name: sheet.name,
      headers: preview.headers.map(h => (h === null || h === undefined ? '' : String(h))),
      preview: preview.preview,
      row_count: preview.rows.length,
      header_rows: preview.header_rows,
      mapping,
      layout,
      mapping_source: source,
      ai_confidence: ai?.confidence ?? null,
      ai_warnings: [
        ...(chosen.template_rejected ? ['ชีตชื่อนี้เคยนำเข้ามาก่อน แต่หัวตารางของไฟล์นี้ต่างจากไฟล์เดิม จึงอ่านโครงใหม่แทนการใช้รูปแบบเดิม'] : []),
        ...(ai?.warnings ?? []),
      ],
      item_count: split.items.length,
      section_count: split.sections.length,
      cost_total: Math.round(cost * 100) / 100,
      sell_total: Math.round(sell * 100) / 100,
      cost_mode: split.cost_mode,
      missing_cost_items: split.missing_cost_items,
      suggested,
      deduction_headings: split.deduction_headings,
      deduction_items: split.deduction_items,
      markup_column_rejected: split.markup_column_rejected,
      ai_status: outcome.status === 'ok' ? (source === 'ai' ? 'used' : 'unused') : outcome.status,
      ai_error: outcome.status === 'failed' ? outcome.reason : null,
      check_count: check.checked,
      check_issues: check.issues.slice(0, 30),
      is_detail: ai ? ai.is_boq_detail_sheet : hasPriceColumns && split.items.length > 0,
      contract: check.contract,
    }
  })

  return { ok: true, data: { file_path: path, file_name: file.name, sheets } }
  void user
}

export interface ImportSheetInput {
  name: string
  mapping: ColumnMapping
  layout: SheetLayout
  include: boolean
}

// ขั้นที่ 2: นำเข้าเป็น boq_version ใหม่ (quotation หรือ VO) บันทึก mapping เป็น template ตามชื่อชีต
export async function importBoq(
  projectId: string,
  filePath: string,
  fileName: string,
  type: BoqVersionType,
  sheets: ImportSheetInput[],
  defaultMarkupPct: number,
  note: string,
  // มูลค่าสัญญาที่อ่านจากไฟล์: set = ตั้งเป็นมูลค่าสัญญา (BOQ ใหม่), add = บวกเพิ่ม (VO)
  contract: { mode: 'set' | 'add'; amount: number } | null = null
): Promise<ActionResult<{ version_id: string; contract_error: string | null }>> {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: fileData, error: dlErr } = await supabase.storage.from('project-files').download(filePath)
  if (dlErr || !fileData) return fail('ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่')
  const rawSheets = await readSheets(Buffer.from(await fileData.arrayBuffer()))

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
    await supabase.from('boq_versions').update({ source_file_path: filePath, source_file_name: fileName || null }).eq('id', versionId)
  } else {
    const { data, error } = await supabase
      .from('boq_versions')
      .insert({ project_id: projectId, version_no: nextNo, type: 'quotation', status: 'draft', source_file_path: filePath, source_file_name: fileName || null, note: note || null, created_by: user.id })
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
    const rawSheet = rawSheets.find(s => s.name === sheetInput.name)
    if (!rawSheet) continue
    const sheet = buildPreview(rawSheet.name, rawSheet.grid, sheetInput.layout ?? detectLayout(rawSheet.grid))
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
      .upsert(
        {
          sheet_name: sheetInput.name,
          mapping: { columns: sheetInput.mapping, layout: sheetInput.layout, headers: templateHeaders(sheet.headers, sheetInput.mapping) },
          created_by: user.id,
        },
        { onConflict: 'sheet_name' }
      )
  }

  if (totalItems === 0 && type !== 'variation_order') {
    await supabase.from('boq_versions').delete().eq('id', versionId)
    return fail('ไม่พบรายการที่นำเข้าได้ ตรวจสอบการจับคู่คอลัมน์')
  }

  revalidatePath(`/projects/${projectId}`)
  // ทำหลังนำเข้ารายการสำเร็จเท่านั้น นำเข้าไม่สำเร็จมูลค่าสัญญาต้องไม่เปลี่ยน
  let contractError: string | null = null
  if (contract && contract.amount > 0) {
    let next = Math.round(contract.amount * 100) / 100
    if (contract.mode === 'add') {
      const { data: proj } = await supabase.from('projects').select('contract_value').eq('id', projectId).single()
      next = Math.round((Number(proj?.contract_value ?? 0) + contract.amount) * 100) / 100
    }
    const { data: updated, error: cErr } = await supabase.from('projects').update({ contract_value: next }).eq('id', projectId).select('id')
    if (cErr) contractError = cErr.message
    else if (!updated?.length) contractError = 'ไม่มีสิทธิ์แก้ไขโครงการนี้'
  }

  revalidatePath('/')
  return { ok: true, data: { version_id: versionId, contract_error: contractError } }
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

export async function unconfirmBoqVersion(versionId: string, projectId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('unconfirm_boq_version', { p_version_id: versionId })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/boq/${versionId}`)
  revalidatePath('/')
  return { ok: true, data: undefined }
}

export async function deleteBoqVersion(versionId: string, projectId: string): Promise<ActionResult> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('boq_versions').delete().eq('id', versionId)
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { ok: true, data: undefined }
}

// เปิดร่างสำหรับแก้ BOQ ที่ยืนยันแล้ว ถ้ามีร่างค้างอยู่จะใช้อันเดิมต่อ
export async function startBoqRevision(projectId: string): Promise<ActionResult<{ version_id: string }>> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_variation_order', { p_project_id: projectId, p_note: null })
  if (error) return fail(error)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, data: { version_id: data as string } }
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
