// Seed ข้อมูลทดสอบ: 3 สาขา (จาก migration), ผู้ใช้ทดสอบครบทุก role, โครงการตัวอย่าง 1 โครงการ
// BOQ 30 รายการ (แตกวัสดุ/แรงงาน) ยืนยันแล้ว พร้อม PR PO รับของ invoice payment expense ตัวอย่าง
// ใช้ service role key (ข้าม RLS) รัน: npm run seed
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { SAMPLE_BOQ, SAMPLE_MARKUP_PCT } from './boq-sample-data'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.SEED_USER_PASSWORD || 'S2000test!'
if (!url || !key) {
  console.error('ต้องตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const USERS = [
  { email: 'engineer@s2000.test', full_name: 'สมชาย วิศวกร', role: 'engineer' },
  { email: 'site@s2000.test', full_name: 'สมศักดิ์ หัวหน้าหน้างาน', role: 'site_supervisor' },
  { email: 'pm@s2000.test', full_name: 'วิภา ผู้จัดการโครงการ', role: 'project_manager' },
  { email: 'purchasing@s2000.test', full_name: 'นภา จัดซื้อ', role: 'purchasing' },
  { email: 'accounting@s2000.test', full_name: 'อรทัย บัญชี', role: 'accounting' },
  { email: 'management@s2000.test', full_name: 'ธนา ผู้บริหาร', role: 'management' },
  { email: 'admin@s2000.test', full_name: 'ผู้ดูแลระบบ', role: 'admin' },
]

function die(msg: string, err: unknown): never {
  console.error(msg, err)
  process.exit(1)
}

async function ensureUser(u: (typeof USERS)[number], branchId: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users.find(x => x.email === u.email)
  if (existing) {
    await admin.from('profiles').upsert({ id: existing.id, full_name: u.full_name, role: u.role, branch_id: branchId, is_active: true })
    return existing.id
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name, role: u.role, branch_id: branchId },
  })
  if (error || !data.user) die(`สร้างผู้ใช้ ${u.email} ไม่สำเร็จ`, error)
  await admin.from('profiles').upsert({ id: data.user.id, full_name: u.full_name, role: u.role, branch_id: branchId, is_active: true })
  return data.user.id
}

async function main() {
  const { data: branches } = await admin.from('branches').select('id, code')
  const asia = branches?.find(b => b.code === 'ASIA')?.id
  if (!asia) die('ไม่พบสาขา ASIA รัน migration ก่อน', null)

  const ids: Record<string, string> = {}
  for (const u of USERS) ids[u.role] = await ensureUser(u, asia)
  console.log('ผู้ใช้ทดสอบพร้อม (รหัสผ่านทุกคน:', password, ')')

  // โครงการตัวอย่าง (ข้ามถ้ามีแล้ว)
  const code = 'PJ-2569-001'
  const { data: existingProject } = await admin.from('projects').select('id').eq('code', code).maybeSingle()
  if (existingProject) {
    console.log('โครงการตัวอย่างมีอยู่แล้ว ข้ามการ seed ข้อมูลโครงการ')
    return
  }
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const addDays = (n: number) => new Date(today.getTime() + n * 86400000)

  const { data: project, error: pErr } = await admin
    .from('projects')
    .insert({
      code,
      name: 'โรงงานผลิตชิ้นส่วน อาคาร A',
      customer_name: 'บริษัท ไทยพาร์ท อินดัสทรี จำกัด',
      branch_id: asia,
      contract_value: 5200000,
      start_date: iso(addDays(-30)),
      planned_end_date: iso(addDays(90)),
      status: 'draft',
      retention_pct: 5,
      penalty_per_day: 5000,
      created_by: ids.management,
    })
    .select('id')
    .single()
  if (pErr || !project) die('สร้างโครงการไม่สำเร็จ', pErr)
  const projectId = project.id

  await admin.from('project_members').insert([
    { project_id: projectId, user_id: ids.project_manager, role_in_project: 'pm' },
    { project_id: projectId, user_id: ids.engineer, role_in_project: 'engineer' },
    { project_id: projectId, user_id: ids.site_supervisor, role_in_project: 'site' },
  ])

  // BOQ version 1
  const { data: version, error: vErr } = await admin
    .from('boq_versions')
    .insert({ project_id: projectId, version_no: 1, type: 'quotation', status: 'draft', note: 'BOQ ฉบับลงนาม', created_by: ids.project_manager })
    .select('id')
    .single()
  if (vErr || !version) die('สร้าง BOQ version ไม่สำเร็จ', vErr)

  const sectionIds: string[] = []
  let currentSection = -1
  const itemRows: Record<string, unknown>[] = []
  let sort = 0
  for (const r of SAMPLE_BOQ) {
    if (r.qty === null) {
      const { data: sec } = await admin
        .from('boq_sections')
        .insert({ boq_version_id: version.id, code: r.item_no, name: r.description, sort_order: sectionIds.length })
        .select('id')
        .single()
      sectionIds.push(sec!.id)
      currentSection = sectionIds.length - 1
      continue
    }
    const push = (category: 'material' | 'labor', unitCost: number) =>
      itemRows.push({
        boq_version_id: version.id,
        section_id: sectionIds[currentSection],
        item_no: r.item_no,
        description: r.description,
        unit: r.unit,
        qty: r.qty,
        unit_cost: unitCost,
        category,
        markup_pct: SAMPLE_MARKUP_PCT,
        sell_unit_price: Math.round(unitCost * (1 + SAMPLE_MARKUP_PCT / 100) * 100) / 100,
        sort_order: sort++,
      })
    if (r.material) push('material', r.material)
    if (r.labor) push('labor', r.labor)
  }
  const { data: items, error: iErr } = await admin.from('boq_items').insert(itemRows).select('id, item_no, category, unit_cost, qty, unit, description')
  if (iErr || !items) die('สร้างรายการ BOQ ไม่สำเร็จ', iErr)

  // ยืนยัน BOQ (ทำแทน confirm_boq_version เพราะ service role ไม่มี auth.uid())
  const { data: offItem } = await admin
    .from('boq_items')
    .insert({ boq_version_id: version.id, item_no: 'OFF', description: 'นอก BOQ', unit: 'รายการ', qty: 0, unit_cost: 0, category: 'other', sort_order: 999999, is_off_boq: true })
    .select('id')
    .single()
  await admin.from('boq_versions').update({ status: 'confirmed', type: 'confirmed', confirmed_by: ids.management, confirmed_at: new Date().toISOString() }).eq('id', version.id)
  await admin.from('projects').update({ status: 'active' }).eq('id', projectId)

  // ซัพพลายเออร์
  const { data: suppliers } = await admin
    .from('suppliers')
    .insert([
      { name: 'บริษัท เหล็กใต้ จำกัด', tax_id: '0905555000111', phone: '074-000-111', note: 'สต็อกเหล็กภายในกลุ่ม' },
      { name: 'หจก. สยามเมทัลชีท', tax_id: '0903333000222', phone: '074-000-222' },
      { name: 'บริษัท ไฟฟ้าภาคใต้ซัพพลาย จำกัด', tax_id: '0904444000333', phone: '074-000-333' },
    ])
    .select('id, name')
  const supSteel = suppliers![0].id
  const supSheet = suppliers![1].id

  const find = (itemNo: string, cat: 'material' | 'labor') => items.find(i => i.item_no === itemNo && i.category === cat)!
  const col = find('1.1', 'material')
  const beam = find('1.2', 'material')
  const roof = find('2.1', 'material')
  const crane = find('1.11', 'labor')

  const num = (n: number) => `${n}`.padStart(4, '0')
  const period = `${String(today.getFullYear() % 100).padStart(2, '0')}${String(today.getMonth() + 1).padStart(2, '0')}`
  let prSeq = 0
  let poSeq = 0
  await admin.from('document_counters').upsert([{ doc_type: 'PR', period, last_no: 4 }, { doc_type: 'PO', period, last_no: 2 }])

  // PR 1: เสาและคาน อนุมัติแล้ว + PO + รับของบางส่วน + invoice + payment
  const { data: pr1 } = await admin
    .from('purchase_requests')
    .insert({ pr_no: `PR-${period}-${num(++prSeq)}`, project_id: projectId, requested_by: ids.engineer, status: 'approved', needed_by_date: iso(addDays(-10)), note: 'ล็อตแรก งานฐานราก', total_amount: 18.5 * 31500 + 12 * 31000, requires_management: true, submitted_at: addDays(-20).toISOString(), created_by: ids.engineer })
    .select('id')
    .single()
  const { data: pr1Items } = await admin
    .from('purchase_request_items')
    .insert([
      { pr_id: pr1!.id, boq_item_id: col.id, description: col.description, qty: 18.5, unit: 'ตัน', unit_price: 31500, supplier_id: supSteel, supplier_name: 'บริษัท เหล็กใต้ จำกัด' },
      { pr_id: pr1!.id, boq_item_id: beam.id, description: beam.description, qty: 12, unit: 'ตัน', unit_price: 31000, supplier_id: supSteel, supplier_name: 'บริษัท เหล็กใต้ จำกัด' },
    ])
    .select('id, boq_item_id, description, qty, unit, unit_price')
  await admin.from('approvals').insert([
    { document_type: 'purchase_request', document_id: pr1!.id, step: 'pm', approver_id: ids.project_manager, decision: 'approved', comment: 'ตามแผน', decided_at: addDays(-19).toISOString() },
    { document_type: 'purchase_request', document_id: pr1!.id, step: 'management', approver_id: ids.management, decision: 'approved', decided_at: addDays(-18).toISOString() },
  ])
  const { data: po1 } = await admin
    .from('purchase_orders')
    .insert({ po_no: `PO-${period}-${num(++poSeq)}`, project_id: projectId, pr_id: pr1!.id, supplier_id: supSteel, status: 'issued', issued_at: addDays(-17).toISOString(), total_amount: 18.5 * 31500 + 12 * 31000, created_by: ids.purchasing })
    .select('id')
    .single()
  const { data: po1Items } = await admin
    .from('purchase_order_items')
    .insert(pr1Items!.map(i => ({ po_id: po1!.id, boq_item_id: i.boq_item_id, pr_item_id: i.id, description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price })))
    .select('id, boq_item_id, qty, unit_price')
  const { data: gr1 } = await admin
    .from('goods_receipts')
    .insert({ po_id: po1!.id, received_by: ids.site_supervisor, received_at: addDays(-12).toISOString(), source: 'internal_stock', note: 'รับเสาครบ คานมาบางส่วน' })
    .select('id')
    .single()
  await admin.from('goods_receipt_items').insert([
    { receipt_id: gr1!.id, po_item_id: po1Items![0].id, boq_item_id: po1Items![0].boq_item_id, qty_received: 18.5, unit_cost: 30800 },
    { receipt_id: gr1!.id, po_item_id: po1Items![1].id, boq_item_id: po1Items![1].boq_item_id, qty_received: 8, unit_cost: 31000 },
  ])
  const { data: inv1 } = await admin
    .from('invoices')
    .insert({ supplier_id: supSteel, project_id: projectId, po_id: po1!.id, invoice_no: 'IV-6809-0451', invoice_date: iso(addDays(-10)), amount: 18.5 * 30800 + 8 * 31000, due_date: iso(addDays(2)), status: 'approved', created_by: ids.accounting })
    .select('id')
    .single()
  await admin.from('payments').insert({ invoice_id: inv1!.id, paid_at: iso(addDays(-3)), amount: 400000, method: 'transfer', reference_no: 'TRF-000123', recorded_by: ids.accounting })

  // PR 2: เมทัลชีท อนุมัติแล้ว + PO ออกแล้ว ยังไม่รับของ (committed)
  const { data: pr2 } = await admin
    .from('purchase_requests')
    .insert({ pr_no: `PR-${period}-${num(++prSeq)}`, project_id: projectId, requested_by: ids.engineer, status: 'approved', needed_by_date: iso(addDays(7)), total_amount: 1420 * 285, requires_management: true, submitted_at: addDays(-6).toISOString(), created_by: ids.engineer })
    .select('id')
    .single()
  const { data: pr2Items } = await admin
    .from('purchase_request_items')
    .insert([{ pr_id: pr2!.id, boq_item_id: roof.id, description: roof.description, qty: 1420, unit: 'ตร.ม.', unit_price: 285, supplier_id: supSheet, supplier_name: 'หจก. สยามเมทัลชีท' }])
    .select('id, boq_item_id, description, qty, unit, unit_price')
  await admin.from('approvals').insert([
    { document_type: 'purchase_request', document_id: pr2!.id, step: 'pm', approver_id: ids.project_manager, decision: 'approved', decided_at: addDays(-5).toISOString() },
    { document_type: 'purchase_request', document_id: pr2!.id, step: 'management', approver_id: ids.management, decision: 'approved', decided_at: addDays(-5).toISOString() },
  ])
  const { data: po2 } = await admin
    .from('purchase_orders')
    .insert({ po_no: `PO-${period}-${num(++poSeq)}`, project_id: projectId, pr_id: pr2!.id, supplier_id: supSheet, status: 'issued', issued_at: addDays(-4).toISOString(), total_amount: 1420 * 285, created_by: ids.purchasing })
    .select('id')
    .single()
  await admin.from('purchase_order_items').insert(pr2Items!.map(i => ({ po_id: po2!.id, boq_item_id: i.boq_item_id, pr_item_id: i.id, description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price })))

  // PR 3: รถเครน รอ PM (ในวงเงิน)
  const { data: pr3 } = await admin
    .from('purchase_requests')
    .insert({ pr_no: `PR-${period}-${num(++prSeq)}`, project_id: projectId, requested_by: ids.site_supervisor, status: 'pending_pm', needed_by_date: iso(addDays(3)), note: 'เครนติดตั้งคานสัปดาห์หน้า', total_amount: 4 * 8500, requires_management: false, submitted_at: addDays(-1).toISOString(), created_by: ids.site_supervisor })
    .select('id')
    .single()
  await admin.from('purchase_request_items').insert([{ pr_id: pr3!.id, boq_item_id: crane.id, description: crane.description, qty: 4, unit: 'วัน', unit_price: 8500 }])

  // PR 4: คานเพิ่ม เกิน BOQ และแพงกว่าราคาทด รอ management (PM อนุมัติแล้ว)
  const { data: pr4 } = await admin
    .from('purchase_requests')
    .insert({ pr_no: `PR-${period}-${num(++prSeq)}`, project_id: projectId, requested_by: ids.engineer, status: 'pending_management', needed_by_date: iso(addDays(10)), note: 'แบบแก้ไขเพิ่มคานรับเครนราง', total_amount: 14 * 33500, requires_management: true, submitted_at: addDays(-1).toISOString(), created_by: ids.engineer })
    .select('id')
    .single()
  await admin.from('purchase_request_items').insert([
    { pr_id: pr4!.id, boq_item_id: beam.id, description: beam.description, qty: 14, unit: 'ตัน', unit_price: 33500, supplier_id: supSteel, supplier_name: 'บริษัท เหล็กใต้ จำกัด', variance_reason: 'ลูกค้าแก้แบบเพิ่มคานรับเครนราง 2 ตัว และราคาเหล็กตลาดปรับขึ้น', qty_over_boq: true, price_over_threshold: true },
  ])
  await admin.from('approvals').insert([{ document_type: 'purchase_request', document_id: pr4!.id, step: 'pm', approver_id: ids.project_manager, decision: 'approved', comment: 'ยืนยันตามแบบแก้ไข rev.2', decided_at: new Date().toISOString() }])

  // ค่าใช้จ่ายเบ็ดเตล็ด
  await admin.from('expenses').insert([
    { project_id: projectId, boq_item_id: offItem!.id, expense_date: iso(addDays(-8)), amount: 3200, description: 'ค่าน้ำมันรถขนอุปกรณ์ (เหตุผลนอก BOQ: ไม่มีรายการค่าน้ำมันใน BOQ)', paid_by: ids.engineer, created_by: ids.engineer },
    { project_id: projectId, boq_item_id: crane.id, expense_date: iso(addDays(-5)), amount: 8500, description: 'ค่าเครนวันแรก จ่ายเงินสดหน้างาน', paid_by: ids.site_supervisor, created_by: ids.site_supervisor },
  ])

  // notification ตัวอย่างให้ PM และ management
  await admin.from('notifications').insert([
    { user_id: ids.project_manager, event: 'pr_pending', title: `ใบขอซื้อ PR-${period}-0003 รออนุมัติ`, body: 'โรงงานผลิตชิ้นส่วน อาคาร A มูลค่า 34,000.00 บาท', link: `/pr/${pr3!.id}` },
    { user_id: ids.management, event: 'pr_pending', title: `ใบขอซื้อ PR-${period}-0004 รอฝ่ายบริหารอนุมัติ`, body: 'เกิน BOQ และเกินราคาที่ทดไว้', link: `/pr/${pr4!.id}` },
  ])

  console.log('seed เสร็จ: โครงการ', code, 'BOQ', items.length, 'รายการ (จาก 30 แถว แตกวัสดุ/แรงงาน)')
}

main().catch(e => die('seed ล้มเหลว', e))
