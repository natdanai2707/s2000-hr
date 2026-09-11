import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { TEST_DATABASE_URL, resetDatabase, createUser, runAs, n } from './helpers'

// ทดสอบกับ Postgres จริงผ่าน TEST_DATABASE_URL (ข้ามถ้าไม่ตั้งค่า)
// ครอบคลุม: RLS แยกโครงการ, ตัวเลข 4 ชั้นจาก view, approval routing ที่ DB, ล็อก BOQ, audit log
describe.skipIf(!TEST_DATABASE_URL)('database: migrations, RLS, views, functions', () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL })
  let mgmt: string, pmA: string, engA: string, engB: string, purchasing: string, accounting: string, site: string
  let projectA: string, projectB: string, versionA: string
  let itemSteel: string, itemLabor: string, itemOff: string
  let prId: string, poId: string

  beforeAll(async () => {
    await client.connect()
    await resetDatabase(client)
    mgmt = await createUser(client, 'mgmt@test', 'ผู้บริหาร', 'management')
    pmA = await createUser(client, 'pm@test', 'PM A', 'project_manager')
    engA = await createUser(client, 'enga@test', 'วิศวกร A', 'engineer')
    engB = await createUser(client, 'engb@test', 'วิศวกร B', 'engineer')
    purchasing = await createUser(client, 'buy@test', 'จัดซื้อ', 'purchasing')
    accounting = await createUser(client, 'acc@test', 'บัญชี', 'accounting')
    site = await createUser(client, 'site@test', 'หัวหน้าหน้างาน', 'site_supervisor')

    const branch = (await client.query(`select id from public.branches where code = 'ASIA'`)).rows[0].id
    // management สร้าง 2 โครงการ
    await runAs(client, mgmt, async q => {
      projectA = (await q(`insert into public.projects (code, name, branch_id, contract_value, planned_end_date, created_by) values ('A', 'โครงการ A', $1, 1000000, current_date + 30, $2) returning id`, [branch, mgmt])).rows[0].id as string
      projectB = (await q(`insert into public.projects (code, name, branch_id, contract_value, created_by) values ('B', 'โครงการ B', $1, 500000, $2) returning id`, [branch, mgmt])).rows[0].id as string
      await q(`insert into public.project_members (project_id, user_id) values ($1, $2), ($1, $3), ($1, $4), ($5, $6)`, [projectA, pmA, engA, site, projectB, engB])
      versionA = (await q(`insert into public.boq_versions (project_id, version_no, type, status, created_by) values ($1, 1, 'quotation', 'draft', $2) returning id`, [projectA, mgmt])).rows[0].id as string
      const sec = (await q(`insert into public.boq_sections (boq_version_id, name, sort_order) values ($1, 'งานโครงสร้าง', 0) returning id`, [versionA])).rows[0].id
      itemSteel = (await q(`insert into public.boq_items (boq_version_id, section_id, item_no, description, unit, qty, unit_cost, category, markup_pct, sell_unit_price) values ($1, $2, '1.1', 'เหล็ก H-Beam', 'ตัน', 100, 30000, 'material', 10, 33000) returning id`, [versionA, sec])).rows[0].id as string
      itemLabor = (await q(`insert into public.boq_items (boq_version_id, section_id, item_no, description, unit, qty, unit_cost, category, markup_pct, sell_unit_price) values ($1, $2, '1.1', 'เหล็ก H-Beam (ค่าแรง)', 'ตัน', 100, 2000, 'labor', 10, 2200) returning id`, [versionA, sec])).rows[0].id as string
      // โครงการ B มี BOQ ยืนยันด้วย
      const vB = (await q(`insert into public.boq_versions (project_id, version_no, type, status, created_by) values ($1, 1, 'quotation', 'draft', $2) returning id`, [projectB, mgmt])).rows[0].id
      await q(`insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category, sell_unit_price) values ($1, '1', 'งาน B', 'งาน', 1, 100000, 'material', 120000)`, [vB])
      await q(`select public.confirm_boq_version($1)`, [vB])
    })
  })

  afterAll(async () => {
    await client.end()
  })

  it('ยืนยัน BOQ: เฉพาะ management, สร้างรายการนอก BOQ, โครงการเป็น active', async () => {
    await expect(runAs(client, pmA, q => q(`select public.confirm_boq_version($1)`, [versionA]))).rejects.toThrow(/ฝ่ายบริหาร/)
    await runAs(client, mgmt, q => q(`select public.confirm_boq_version($1)`, [versionA]))
    const v = (await client.query(`select status, confirmed_by from public.boq_versions where id = $1`, [versionA])).rows[0]
    expect(v.status).toBe('confirmed')
    expect(v.confirmed_by).toBe(mgmt)
    const p = (await client.query(`select status from public.projects where id = $1`, [projectA])).rows[0]
    expect(p.status).toBe('active')
    const off = (await client.query(`select id from public.boq_items where boq_version_id = $1 and is_off_boq`, [versionA])).rows
    expect(off).toHaveLength(1)
    itemOff = off[0].id
  })

  it('BOQ ที่ยืนยันแล้วถูกล็อก แก้ตัวเลขทับไม่ได้', async () => {
    await expect(runAs(client, mgmt, q => q(`update public.boq_items set qty = 200 where id = $1`, [itemSteel]))).rejects.toThrow(/ยืนยันแล้ว/)
    await expect(runAs(client, mgmt, q => q(`delete from public.boq_items where id = $1`, [itemSteel]))).rejects.toThrow(/ยืนยันแล้ว/)
    await expect(runAs(client, mgmt, q => q(`update public.boq_versions set status = 'draft' where id = $1`, [versionA]))).rejects.toThrow(/ย้อนสถานะ/)
  })

  it('RLS: engineer ของโครงการ A อ่านข้อมูลโครงการ B ไม่ได้', async () => {
    const seenByA = await runAs(client, engA, async q => ({
      projects: (await q(`select code from public.projects order by code`)).rows.map(r => r.code),
      items: (await q(`select count(*)::int as c from public.boq_items`)).rows[0].c,
      summary: (await q(`select code from public.v_project_summary`)).rows.map(r => r.code),
      members: (await q(`select count(*)::int as c from public.project_members`)).rows[0].c,
    }))
    expect(seenByA.projects).toEqual(['A'])
    expect(seenByA.summary).toEqual(['A'])
    expect(seenByA.items).toBe(3) // เหล็ก + ค่าแรง + นอก BOQ ของ A เท่านั้น
    expect(seenByA.members).toBe(3)

    const seenByB = await runAs(client, engB, async q => (await q(`select code from public.projects`)).rows.map(r => r.code))
    expect(seenByB).toEqual(['B'])

    // engineer B พยายาม insert PR ในโครงการ A ต้องถูกปฏิเสธ
    await expect(
      runAs(client, engB, q => q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values ('X', $1, $2, 'draft')`, [projectA, engB]))
    ).rejects.toThrow(/row-level security/)
  })

  it('RLS: management/purchasing/accounting เห็นทุกโครงการ', async () => {
    for (const u of [mgmt, purchasing, accounting]) {
      const codes = await runAs(client, u, async q => (await q(`select code from public.projects order by code`)).rows.map(r => r.code))
      expect(codes).toEqual(['A', 'B'])
    }
  })

  it('routing: PR ในวงเงินและไม่เกิน BOQ -> pending_pm -> PM อนุมัติ -> approved', async () => {
    prId = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก H-Beam', 1, 'ตัน', 30000)`, [id, itemSteel])
      const status = (await q(`select public.submit_purchase_request($1) as s`, [id])).rows[0].s
      expect(status).toBe('pending_pm')
      return id
    })
    const pr = (await client.query(`select total_amount, requires_management, pr_no from public.purchase_requests where id = $1`, [prId])).rows[0]
    expect(n(pr.total_amount)).toBe(30000)
    expect(pr.requires_management).toBe(false)
    expect(pr.pr_no).toMatch(/^PR-\d{4}-0001$/)

    // engineer อนุมัติเองไม่ได้
    await expect(runAs(client, engA, q => q(`select public.decide_purchase_request($1, 'approved', null)`, [prId]))).rejects.toThrow(/ผู้จัดการโครงการ/)
    // ปฏิเสธต้องมีเหตุผล
    await expect(runAs(client, pmA, q => q(`select public.decide_purchase_request($1, 'rejected', '')`, [prId]))).rejects.toThrow(/เหตุผล/)
    const next = await runAs(client, pmA, async q => (await q(`select public.decide_purchase_request($1, 'approved', 'ok') as s`, [prId])).rows[0].s)
    expect(next).toBe('approved')
    const approvals = (await client.query(`select step, approver_id, decision from public.approvals where document_id = $1`, [prId])).rows
    expect(approvals).toEqual([{ step: 'pm', approver_id: pmA, decision: 'approved' }])
  })

  it('routing: PR เกินวงเงิน -> pending_pm -> pending_management -> approved', async () => {
    const id = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก', 2, 'ตัน', 30000)`, [id, itemSteel])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })
    expect((await client.query(`select requires_management from public.purchase_requests where id = $1`, [id])).rows[0].requires_management).toBe(true)
    const afterPm = await runAs(client, pmA, async q => (await q(`select public.decide_purchase_request($1, 'approved', null) as s`, [id])).rows[0].s)
    expect(afterPm).toBe('pending_management')
    await expect(runAs(client, pmA, q => q(`select public.decide_purchase_request($1, 'approved', null)`, [id]))).rejects.toThrow(/ฝ่ายบริหาร/)
    const afterMgmt = await runAs(client, mgmt, async q => (await q(`select public.decide_purchase_request($1, 'approved', null) as s`, [id])).rows[0].s)
    expect(afterMgmt).toBe('approved')
  })

  it('routing: เกิน BOQ ต้องมีเหตุผล และตั้ง flag qty_over_boq / requires_management', async () => {
    await expect(
      runAs(client, engA, async q => {
        const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id
        await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก', 200, 'ตัน', 100)`, [id, itemSteel])
        await q(`select public.submit_purchase_request($1)`, [id])
      })
    ).rejects.toThrow(/เหตุผล/)

    const id = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, variance_reason) values ($1, $2, 'เหล็ก', 200, 'ตัน', 100, 'แบบเปลี่ยน')`, [id, itemSteel])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })
    const item = (await client.query(`select qty_over_boq, price_over_threshold from public.purchase_request_items where pr_id = $1`, [id])).rows[0]
    expect(item.qty_over_boq).toBe(true)
    expect(item.price_over_threshold).toBe(false)
    expect((await client.query(`select requires_management from public.purchase_requests where id = $1`, [id])).rows[0].requires_management).toBe(true)
    await runAs(client, engA, q => q(`update public.purchase_requests set status = 'cancelled' where id = $1`, [id]))
  })

  it('routing: ราคาแพงกว่าทดเกิน threshold ตั้ง flag price_over_threshold', async () => {
    const id = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, variance_reason) values ($1, $2, 'เหล็ก', 1, 'ตัน', 32000, 'ราคาตลาดขึ้น')`, [id, itemSteel])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })
    const item = (await client.query(`select qty_over_boq, price_over_threshold from public.purchase_request_items where pr_id = $1`, [id])).rows[0]
    expect(item.price_over_threshold).toBe(true)
    expect((await client.query(`select requires_management from public.purchase_requests where id = $1`, [id])).rows[0].requires_management).toBe(false)
    await runAs(client, engA, q => q(`update public.purchase_requests set status = 'cancelled' where id = $1`, [id]))
  })

  it('4 ชั้นตัวเลข: budget จาก BOQ, committed จาก PO, actual จากรับของ + expenses, paid จาก payments + expenses', async () => {
    // budget
    let row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.budget)).toBe(3000000)
    expect(n(row.committed)).toBe(0)
    expect(n(row.actual)).toBe(0)
    expect(n(row.paid)).toBe(0)

    // purchasing ออก PO จาก PR แรก (1 ตัน × 30000) engineer ทำไม่ได้
    await expect(runAs(client, engA, q => q(`select public.create_po_from_pr($1, null, '[]'::jsonb)`, [prId]))).rejects.toThrow(/จัดซื้อ/)
    poId = await runAs(client, purchasing, async q => (await q(`select public.create_po_from_pr($1, null, '[]'::jsonb) as id`, [prId])).rows[0].id as string)
    const po = (await client.query(`select po_no, status, total_amount from public.purchase_orders where id = $1`, [poId])).rows[0]
    expect(po.po_no).toMatch(/^PO-\d{4}-0001$/)
    expect(po.status).toBe('issued')
    expect(n(po.total_amount)).toBe(30000)
    row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.committed)).toBe(30000)
    expect(n(row.qty_ordered)).toBe(1)
    expect(n(row.qty_remaining)).toBe(99)

    // site_supervisor รับบางส่วน 0.4 ตัน ที่ราคา 30000 -> actual 12000, committed เหลือ 18000
    const poItem = (await client.query(`select id from public.purchase_order_items where po_id = $1`, [poId])).rows[0].id
    await runAs(client, site, async q => {
      const r = (await q(`insert into public.goods_receipts (po_id, received_by, source) values ($1, $2, 'supplier') returning id`, [poId, site])).rows[0].id
      await q(`insert into public.goods_receipt_items (receipt_id, po_item_id, boq_item_id, qty_received, unit_cost) values ($1, $2, $3, 0.4, 30000)`, [r, poItem, itemSteel])
    })
    expect((await client.query(`select status from public.purchase_orders where id = $1`, [poId])).rows[0].status).toBe('partially_received')
    row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.actual)).toBe(12000)
    expect(n(row.committed)).toBe(18000)
    expect(n(row.qty_received)).toBe(0.4)

    // รับส่วนที่เหลือจากสต็อกภายในที่ราคาทุน 28000 -> actual = 12000 + 0.6×28000 = 28800, committed 0, PO received
    await runAs(client, site, async q => {
      const r = (await q(`insert into public.goods_receipts (po_id, received_by, source) values ($1, $2, 'internal_stock') returning id`, [poId, site])).rows[0].id
      await q(`insert into public.goods_receipt_items (receipt_id, po_item_id, boq_item_id, qty_received, unit_cost) values ($1, $2, $3, 0.6, 28000)`, [r, poItem, itemSteel])
    })
    expect((await client.query(`select status from public.purchase_orders where id = $1`, [poId])).rows[0].status).toBe('received')
    row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.actual)).toBe(28800)
    expect(n(row.committed)).toBe(0)

    // accounting บันทึก invoice 30000 และชำระ 10000 -> paid 10000 (กระจายเต็มเพราะ PO มีรายการเดียว)
    const invoiceId = await runAs(client, accounting, async q => {
      const inv = (await q(`insert into public.invoices (project_id, po_id, invoice_no, invoice_date, amount, due_date) values ($1, $2, 'INV-1', current_date, 30000, current_date + 30) returning id`, [projectA, poId])).rows[0].id as string
      await q(`insert into public.payments (invoice_id, paid_at, amount, recorded_by) values ($1, current_date, 10000, $2)`, [inv, accounting])
      return inv
    })
    row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.paid)).toBe(10000)
    expect((await client.query(`select status from public.invoices where id = $1`, [invoiceId])).rows[0].status).toBe('received')
    await runAs(client, accounting, q => q(`insert into public.payments (invoice_id, paid_at, amount, recorded_by) values ($1, current_date, 20000, $2)`, [invoiceId, accounting]))
    expect((await client.query(`select status from public.invoices where id = $1`, [invoiceId])).rows[0].status).toBe('paid')
    row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    expect(n(row.paid)).toBe(30000)

    // expense นอก BOQ นับเป็น actual และ paid พร้อมกัน
    await runAs(client, engA, q => q(`insert into public.expenses (project_id, boq_item_id, expense_date, amount, description, paid_by) values ($1, $2, current_date, 1500, 'ค่าน้ำมัน', $3)`, [projectA, itemOff, engA]))
    const off = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [itemOff])).rows[0]
    expect(n(off.budget)).toBe(0)
    expect(n(off.actual)).toBe(1500)
    expect(n(off.paid)).toBe(1500)

    // สรุปโครงการ
    const s = (await client.query(`select * from public.v_project_summary where project_id = $1`, [projectA])).rows[0]
    expect(n(s.total_budget)).toBe(3200000)
    expect(n(s.expected_profit)).toBe(320000) // 3,520,000 − 3,200,000
    expect(n(s.actual)).toBe(30300)
    expect(n(s.committed)).toBe(0)
    expect(n(s.paid)).toBe(31500)
    expect(n(s.cost_pct)).toBeCloseTo((30300 / 3200000) * 100, 2)
    expect(s.progress_pct).toBeNull()
    // forecast = contract − (actual + committed + budget ส่วนที่ยังไม่สั่ง) = 1,000,000 − (30,300 + 0 + 99×30000 + 100×2000)
    expect(n(s.forecast_profit)).toBe(1000000 - (30300 + 99 * 30000 + 100 * 2000))
  })

  it('paid กระจายลงรายการ BOQ ตามสัดส่วนมูลค่ารายการใน PO ที่มีหลายรายการ', async () => {
    const pr = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก', 1, 'ตัน', 30000), ($1, $3, 'ค่าแรง', 5, 'ตัน', 2000)`, [id, itemSteel, itemLabor])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })
    await runAs(client, pmA, q => q(`select public.decide_purchase_request($1, 'approved', null)`, [pr]))
    const po = await runAs(client, purchasing, async q => (await q(`select public.create_po_from_pr($1, null, '[]'::jsonb) as id`, [pr])).rows[0].id as string)
    await runAs(client, accounting, async q => {
      const inv = (await q(`insert into public.invoices (project_id, po_id, invoice_no, invoice_date, amount) values ($1, $2, 'INV-2', current_date, 40000) returning id`, [projectA, po])).rows[0].id
      await q(`insert into public.payments (invoice_id, paid_at, amount, recorded_by) values ($1, current_date, 20000, $2)`, [inv, accounting])
    })
    const steel = (await client.query(`select paid from public.v_boq_item_costs where boq_item_id = $1`, [itemSteel])).rows[0]
    const labor = (await client.query(`select paid from public.v_boq_item_costs where boq_item_id = $1`, [itemLabor])).rows[0]
    expect(n(steel.paid)).toBe(30000 + 15000) // 20000 × 30000/40000
    expect(n(labor.paid)).toBe(5000) // 20000 × 10000/40000
  })

  it('PO: แก้ราคาแพงขึ้นเกิน threshold ส่ง PR กลับไปอนุมัติใหม่แทนการออก PO', async () => {
    const pr = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status) values (public.next_document_no('PR'), $1, $2, 'draft') returning id`, [projectA, engA])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก', 1, 'ตัน', 30000)`, [id, itemSteel])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })
    await runAs(client, pmA, q => q(`select public.decide_purchase_request($1, 'approved', null)`, [pr]))
    const prItem = (await client.query(`select id from public.purchase_request_items where pr_id = $1`, [pr])).rows[0].id
    const res = await runAs(client, purchasing, async q => (await q(`select public.create_po_from_pr($1, null, $2::jsonb) as id`, [pr, JSON.stringify([{ pr_item_id: prItem, unit_price: 33000 }])])).rows[0].id)
    expect(res).toBeNull()
    const after = (await client.query(`select status from public.purchase_requests where id = $1`, [pr])).rows[0]
    expect(after.status).toBe('pending_pm')
    expect(n((await client.query(`select unit_price, price_over_threshold from public.purchase_request_items where id = $1`, [prItem])).rows[0].unit_price)).toBe(33000)
  })

  it('VO: copy รายการทั้งหมด ยืนยันแล้ว version เก่าเป็น superseded และย้ายเอกสารต้นทุนตาม', async () => {
    const voId = await runAs(client, pmA, async q => (await q(`select public.create_variation_order($1, 'ลูกค้าเพิ่มงาน') as id`, [projectA])).rows[0].id as string)
    const copied = (await client.query(`select count(*)::int as c from public.boq_items where boq_version_id = $1`, [voId])).rows[0].c
    expect(copied).toBe(3)
    // แก้ปริมาณเหล็กใน VO เป็น 120 ตัน
    await runAs(client, pmA, q => q(`update public.boq_items set qty = 120 where boq_version_id = $1 and origin_item_id = $2`, [voId, itemSteel]))
    await runAs(client, mgmt, q => q(`select public.confirm_boq_version($1)`, [voId]))
    expect((await client.query(`select status from public.boq_versions where id = $1`, [versionA])).rows[0].status).toBe('superseded')
    const newSteel = (await client.query(`select id from public.boq_items where boq_version_id = $1 and origin_item_id = $2`, [voId, itemSteel])).rows[0].id
    const row = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [newSteel])).rows[0]
    expect(n(row.budget)).toBe(120 * 30000)
    expect(n(row.actual)).toBe(28800) // ย้ายจากรายการเดิม
    const s = (await client.query(`select confirmed_version_id, total_budget from public.v_project_summary where project_id = $1`, [projectA])).rows[0]
    expect(s.confirmed_version_id).toBe(voId)
    expect(n(s.total_budget)).toBe(120 * 30000 + 100 * 2000)
  })

  it('audit log บันทึกทุกการเปลี่ยนแปลงตัวเลขเงินและสถานะ พร้อมผู้ใช้ ค่าเดิม ค่าใหม่', async () => {
    const logs = (await client.query(`select action, old_value, new_value, user_id from public.audit_logs where table_name = 'purchase_requests' and record_id = $1 order by created_at`, [prId])).rows
    expect(logs[0].action).toBe('INSERT')
    expect(logs[0].user_id).toBe(engA)
    const statusChange = logs.find(l => l.action === 'UPDATE' && l.old_value.status === 'pending_pm' && l.new_value.status === 'approved')
    expect(statusChange).toBeDefined()
    expect(statusChange!.user_id).toBe(pmA)
    // engineer อ่าน audit_logs ไม่ได้ management อ่านได้
    const byEng = await runAs(client, engA, async q => (await q(`select count(*)::int as c from public.audit_logs`)).rows[0].c)
    expect(byEng).toBe(0)
    const byMgmt = await runAs(client, mgmt, async q => (await q(`select count(*)::int as c from public.audit_logs`)).rows[0].c)
    expect(n(byMgmt)).toBeGreaterThan(10)
  })

  it('profiles: ผู้ใช้ทั่วไปเปลี่ยน role ตัวเองไม่ได้', async () => {
    await expect(runAs(client, engA, q => q(`update public.profiles set role = 'management' where id = $1`, [engA]))).rejects.toThrow(/admin/)
    await runAs(client, engA, q => q(`update public.profiles set full_name = 'วิศวกร A2' where id = $1`, [engA]))
  })

  it('notifications: อ่านได้เฉพาะของตัวเอง และ insert ผ่าน authenticated ไม่ได้', async () => {
    await client.query(`insert into public.notifications (user_id, event, title) values ($1, 'pr_pending', 'ทดสอบ'), ($2, 'pr_pending', 'ของคนอื่น')`, [engA, engB])
    const mine = await runAs(client, engA, async q => (await q(`select title from public.notifications`)).rows.map(r => r.title))
    expect(mine).toEqual(['ทดสอบ'])
    await expect(runAs(client, engA, q => q(`insert into public.notifications (user_id, event, title) values ($1, 'x', 'spam')`, [engB]))).rejects.toThrow(/row-level security/)
  })
})
