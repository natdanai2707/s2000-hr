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

  it('BOQ ที่ยืนยันแล้ว: ผู้จัดการโครงการแก้ไม่ได้ ฝ่ายบริหารแก้ได้และมีประวัติ', async () => {
    await expect(runAs(client, pmA, q => q(`update public.boq_items set qty = 200 where id = $1`, [itemSteel]))).rejects.toThrow(/ฝ่ายบริหาร/)
    await expect(runAs(client, mgmt, q => q(`update public.boq_versions set status = 'draft' where id = $1`, [versionA]))).rejects.toThrow(/ย้อนสถานะ/)

    await runAs(client, mgmt, q => q(`update public.boq_items set qty = 120 where id = $1`, [itemSteel]))
    const log = (await client.query(
      `select old_value->>'qty' as old_qty, new_value->>'qty' as new_qty from public.audit_logs
        where table_name = 'boq_items' and record_id = $1 and action = 'UPDATE' order by created_at desc limit 1`, [itemSteel])).rows[0]
    expect([Number(log.old_qty), Number(log.new_qty)]).toEqual([100, 120])
    await runAs(client, mgmt, q => q(`update public.boq_items set qty = 100 where id = $1`, [itemSteel]))
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

  it('แก้ BOQ ที่ยืนยันแล้วโดยไม่ต้องอัปโหลดไฟล์: เปิดร่างซ้ำได้ร่างเดิม แก้ปริมาณแล้วยืนยัน', async () => {
    const versionsBefore = (await client.query(`select count(*)::int as c from public.boq_versions where project_id = $1`, [projectA])).rows[0].c

    // กดแก้ไข BOQ สองครั้งต้องได้ร่างเดิม ไม่ใช่ร่างใหม่สองอัน
    const first = await runAs(client, mgmt, async q => (await q(`select public.create_variation_order($1, null) as id`, [projectA])).rows[0].id as string)
    const second = await runAs(client, mgmt, async q => (await q(`select public.create_variation_order($1, null) as id`, [projectA])).rows[0].id as string)
    expect(second).toBe(first)
    expect((await client.query(`select count(*)::int as c from public.boq_versions where project_id = $1`, [projectA])).rows[0].c).toBe(versionsBefore + 1)

    // เพิ่มปริมาณรายการเดิม และเพิ่มรายการใหม่เข้าไปในร่าง
    const steelDraft = (await client.query(
      `select n.id, n.qty from public.boq_items n join public.boq_items o on o.id = n.origin_item_id
        where n.boq_version_id = $1 and o.description = 'เหล็ก H-Beam'`, [first])).rows[0]
    await runAs(client, mgmt, async q => {
      await q(`update public.boq_items set qty = qty + 10 where id = $1`, [steelDraft.id])
      await q(`insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category, markup_pct, sell_unit_price)
               values ($1, '9.9', 'ตะแกรงเหล็กเพิ่มหน้างาน', 'แผ่น', 10, 5000, 'material', 10, 5500)`, [first])
    })

    await runAs(client, mgmt, q => q(`select public.confirm_boq_version($1)`, [first]))

    const s = (await client.query(`select confirmed_version_id, total_budget from public.v_project_summary where project_id = $1`, [projectA])).rows[0]
    expect(s.confirmed_version_id).toBe(first)
    // งบเพิ่มตามปริมาณที่แก้ บวกรายการใหม่ และต้นทุนจริงที่เกิดไปแล้วยังผูกกับรายการเดิม
    const newSteel = (await client.query(`select * from public.v_boq_item_costs where boq_item_id = $1`, [steelDraft.id])).rows[0]
    expect(n(newSteel.qty)).toBe(n(steelDraft.qty) + 10)
    expect(n(newSteel.actual)).toBe(28800)
    const added = (await client.query(`select budget from public.v_boq_item_costs where boq_version_id = $1 and description = 'ตะแกรงเหล็กเพิ่มหน้างาน'`, [first])).rows[0]
    expect(n(added.budget)).toBe(50000)
  })

  it('งานลดใน VO เป็นรายการติดลบ: หักงบและต้นทุนคาดการณ์ และผูกต้นทุนไม่ได้', async () => {
    const before = (await client.query(`select total_budget, forecast_profit from public.v_project_summary where project_id = $1`, [projectA])).rows[0]
    const vo = await runAs(client, mgmt, async q => (await q(`select public.create_variation_order($1, 'ลูกค้าลดงาน') as id`, [projectA])).rows[0].id as string)
    const deduction = await runAs(client, mgmt, async q =>
      (await q(`insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category, markup_pct, sell_unit_price)
                values ($1, 'ลด1', 'เหล็ก H-Beam (งานลด)', 'ตัน', -5, 30000, 'material', 10, 33000) returning id`, [vo])).rows[0].id as string)
    await runAs(client, mgmt, q => q(`select public.confirm_boq_version($1)`, [vo]))

    const after = (await client.query(`select total_budget, forecast_profit from public.v_project_summary where project_id = $1`, [projectA])).rows[0]
    expect(n(after.total_budget)).toBe(n(before.total_budget) - 150000)
    // งานที่ลดแล้วไม่ต้องใช้เงิน ต้นทุนคาดการณ์จึงลดลงเท่ากับงานลด
    expect(n(after.forecast_profit)).toBe(n(before.forecast_profit) + 150000)

    // ขอซื้อหรือบันทึกค่าใช้จ่ายกับรายการงานลดไม่ได้ แม้เป็นฝ่ายบริหาร
    await expect(runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, engA])).rows[0].id
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price) values ($1, $2, 'เหล็ก', 1, 'ตัน', 30000)`, [id, deduction])
    })).rejects.toThrow(/งานลด/)
    await expect(runAs(client, mgmt, q =>
      q(`insert into public.expenses (project_id, boq_item_id, expense_date, description, amount, created_by) values ($1, $2, current_date, 'ทดสอบ', 100, $3)`, [projectA, deduction, mgmt])
    )).rejects.toThrow(/งานลด/)
  })

  it('ซัพพลายเออร์: ชื่อที่วิศวกรพิมพ์ในใบขอซื้อถูกบันทึกเข้ารายชื่ออัตโนมัติ ไม่สร้างซ้ำ', async () => {
    const currentSteel = (await client.query(
      `select x.boq_item_id from public.v_boq_item_costs x join public.v_project_summary s on s.confirmed_version_id = x.boq_version_id
        where s.project_id = $1 and x.description = 'เหล็ก H-Beam'`, [projectA])).rows[0].boq_item_id
    // วิศวกรเขียนตาราง suppliers ตรงไม่ได้
    await expect(runAs(client, engA, q => q(`insert into public.suppliers (name) values ('แอบเพิ่ม')`))).rejects.toThrow(/row-level security/)

    const linked = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, engA])).rows[0].id
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, supplier_name)
               values ($1, $2, 'เหล็ก', 1, 'ตัน', 30000, 'บจก.เหล็กใต้'), ($1, $2, 'เหล็ก', 1, 'ตัน', 30000, '  บจก.เหล็กใต้ ')`, [id, currentSteel])
      return (await q(`select supplier_id, supplier_name from public.purchase_request_items where pr_id = $1`, [id])).rows
    })
    expect(linked[0].supplier_id).toBeTruthy()
    expect(linked[1].supplier_id).toBe(linked[0].supplier_id)
    const rows = (await client.query(`select name from public.suppliers where public.normalize_supplier_name(name) = 'บจก.เหล็กใต้'`)).rows
    expect(rows).toEqual([{ name: 'บจก.เหล็กใต้' }])

    // เลือกจากรายชื่อด้วย id อย่างเดียว ระบบเติมชื่อให้
    const named = await runAs(client, engA, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, engA])).rows[0].id
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, supplier_id) values ($1, $2, 'เหล็ก', 1, 'ตัน', 30000, $3)`, [id, currentSteel, linked[0].supplier_id])
      return (await q(`select supplier_name from public.purchase_request_items where pr_id = $1`, [id])).rows[0].supplier_name
    })
    expect(named).toBe('บจก.เหล็กใต้')

    // ผู้ใช้ที่ไม่ได้ล็อกอินเรียกสร้างซัพพลายเออร์ไม่ได้
    await expect(client.query(`set role anon; select public.ensure_supplier('x')`)).rejects.toThrow(/permission denied/)
    await client.query('reset role')
  })

  it('บันทึกซื้อตรง: ฝ่ายบริหารบันทึกครั้งเดียวได้ทั้งอนุมัติ ใบสั่งซื้อ และรับของ ต้นทุนเข้าเป็นต้นทุนจริงทันที', async () => {
    const steel = (await client.query(
      `select x.boq_item_id, x.actual, x.committed from public.v_boq_item_costs x join public.v_project_summary s on s.confirmed_version_id = x.boq_version_id
        where s.project_id = $1 and x.description = 'เหล็ก H-Beam'`, [projectA])).rows[0]
    await client.query(`insert into public.project_members (project_id, user_id) values ($1, $2) on conflict do nothing`, [projectA, mgmt])

    const newPr = async (userId: string) => runAs(client, userId, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, userId])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, supplier_name) values ($1, $2, 'เหล็ก H-Beam', 1, 'ตัน', 30000, 'บจก.เหล็กใต้')`, [id, steel.boq_item_id])
      await q(`select public.submit_purchase_request($1)`, [id])
      return id
    })

    // วิศวกรใช้ทางลัดนี้ไม่ได้ ต้องผ่านการอนุมัติตามปกติ
    const engPr = await newPr(engA)
    await expect(runAs(client, engA, q => q(`select public.record_direct_purchase($1)`, [engPr]))).rejects.toThrow(/ฝ่ายบริหาร/)

    // ใบที่อนุมัติแล้วแต่ยังไม่มีใบสั่งซื้อ (ค้างจากก่อนเปิดโหมด) ฝ่ายบริหารบันทึกเป็นต้นทุนได้
    await runAs(client, mgmt, q => q(`select public.decide_purchase_request($1, 'approved', null)`, [engPr]))
    const legacyPo = await runAs(client, mgmt, async q => (await q(`select public.record_direct_purchase($1) as id`, [engPr])).rows[0].id as string)
    expect((await client.query(`select status from public.purchase_orders where id = $1`, [legacyPo])).rows[0].status).toBe('received')
    await expect(runAs(client, mgmt, q => q(`select public.record_direct_purchase($1)`, [engPr]))).rejects.toThrow(/ออกใบสั่งซื้อแล้ว/)
    const base = (await client.query(`select actual from public.v_boq_item_costs where boq_item_id = $1`, [steel.boq_item_id])).rows[0]
    steel.actual = base.actual

    const pr = await newPr(mgmt)
    const poId = await runAs(client, mgmt, async q => (await q(`select public.record_direct_purchase($1) as id`, [pr])).rows[0].id as string)

    expect((await client.query(`select status from public.purchase_requests where id = $1`, [pr])).rows[0].status).toBe('approved')
    expect((await client.query(`select step from public.approvals where document_id = $1`, [pr])).rows.map(r => r.step)).toEqual(['direct'])
    const po = (await client.query(`select status, total_amount, s.name as supplier from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id where po.id = $1`, [poId])).rows[0]
    expect(po).toMatchObject({ status: 'received', supplier: 'บจก.เหล็กใต้' })
    expect(n(po.total_amount)).toBe(30000)

    const after = (await client.query(`select actual, committed from public.v_boq_item_costs where boq_item_id = $1`, [steel.boq_item_id])).rows[0]
    expect(n(after.actual)).toBe(n(steel.actual) + 30000)
    expect(n(after.committed)).toBe(n(steel.committed))

    // เรียกซ้ำกับใบเดิมไม่ได้ และปิดโหมดแล้วใช้ไม่ได้
    await expect(runAs(client, mgmt, q => q(`select public.record_direct_purchase($1)`, [pr]))).rejects.toThrow(/ออกใบสั่งซื้อแล้ว/)
    await client.query(`update public.settings set value = 'false'::jsonb where key = 'direct_purchase_mode'`)
    const pr2 = await newPr(mgmt)
    await expect(runAs(client, mgmt, q => q(`select public.record_direct_purchase($1)`, [pr2]))).rejects.toThrow(/ไม่ได้เปิดโหมด/)
    await client.query(`update public.settings set value = 'true'::jsonb where key = 'direct_purchase_mode'`)

    // บันทึกผิด ยกเลิกได้ ต้องมีเหตุผล ต้นทุนจริงกลับไปเท่าเดิม และประวัติยังอยู่ใน audit log
    await expect(runAs(client, mgmt, q => q(`select public.void_direct_purchase($1, '')`, [pr]))).rejects.toThrow(/เหตุผล/)
    await expect(runAs(client, engA, q => q(`select public.void_direct_purchase($1, 'x')`, [pr]))).rejects.toThrow(/ฝ่ายบริหาร/)
    await runAs(client, mgmt, q => q(`select public.void_direct_purchase($1, 'กรอกราคาผิด')`, [pr]))
    const voided = (await client.query(`select actual from public.v_boq_item_costs where boq_item_id = $1`, [steel.boq_item_id])).rows[0]
    expect(n(voided.actual)).toBe(n(steel.actual))
    expect((await client.query(`select status from public.purchase_requests where id = $1`, [pr])).rows[0].status).toBe('cancelled')
    expect((await client.query(`select status from public.purchase_orders where id = $1`, [poId])).rows[0].status).toBe('cancelled')
    const logged = (await client.query(`select count(*)::int as c from public.audit_logs where table_name = 'goods_receipt_items' and action = 'DELETE'`)).rows[0].c
    expect(logged).toBeGreaterThan(0)
  })

  it('แก้ BOQ ที่ยืนยันแล้วหลังมีเอกสารต้นทุน: แก้ได้ แต่ลบหรือเปลี่ยนเป็นงานลดไม่ได้ เวอร์ชันเก่าล็อก', async () => {
    const cur = (await client.query(`select confirmed_version_id from public.v_project_summary where project_id = $1`, [projectA])).rows[0].confirmed_version_id
    const steel = (await client.query(`select boq_item_id from public.v_boq_item_costs where boq_version_id = $1 and description = 'เหล็ก H-Beam'`, [cur])).rows[0].boq_item_id
    const off = (await client.query(`select id from public.boq_items where boq_version_id = $1 and is_off_boq`, [cur])).rows[0].id

    await runAs(client, mgmt, async q => {
      await q(`update public.boq_items set unit_cost = 29500 where id = $1`, [steel])
      await q(`insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category, sell_unit_price) values ($1, '9.8', 'งานเพิ่มหน้างาน', 'งาน', 1, 1000, 'labor', 1200)`, [cur])
    })
    expect(Number((await client.query(`select unit_cost from public.boq_items where id = $1`, [steel])).rows[0].unit_cost)).toBe(29500)

    await expect(runAs(client, mgmt, q => q(`delete from public.boq_items where id = $1`, [steel]))).rejects.toThrow(/foreign key/)
    await expect(runAs(client, mgmt, q => q(`update public.boq_items set qty = -1 where id = $1`, [steel]))).rejects.toThrow(/งานลด/)
    await expect(runAs(client, mgmt, q => q(`delete from public.boq_items where id = $1`, [off]))).rejects.toThrow(/นอก BOQ/)

    const old = (await client.query(`select id from public.boq_items where boq_version_id = $1 limit 1`, [versionA])).rows[0].id
    await expect(runAs(client, mgmt, q => q(`update public.boq_items set qty = 1 where id = $1`, [old]))).rejects.toThrow(/ถูกแทนที่/)
  })

  it('ซื้อเป็นหน่วยอื่นจาก BOQ: เทียบ BOQ ด้วยหน่วย BOQ ยอดเงินตามหน่วยที่ซื้อจริง', async () => {
    const cur = (await client.query(`select confirmed_version_id from public.v_project_summary where project_id = $1`, [projectA])).rows[0].confirmed_version_id
    // รายการเหล็กคิดเป็นกิโล ต้นทุน 30 บาทต่อกิโล ปริมาณ 3,000 กิโล
    const kg = await runAs(client, mgmt, async q =>
      (await q(`insert into public.boq_items (boq_version_id, item_no, description, unit, qty, unit_cost, category, sell_unit_price)
                values ($1, '7.1', 'เหล็ก H-BEAM (49.9 kg/m) Size 6 m.', 'kg', 3000, 30, 'material', 33) returning id`, [cur])).rows[0].id as string)
    await client.query(`insert into public.project_members (project_id, user_id) values ($1, $2) on conflict do nothing`, [projectA, mgmt])

    const buy = async (pieces: number, pricePerPiece: number, reason: string | null) => runAs(client, mgmt, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, mgmt])).rows[0].id as string
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, qty_factor, variance_reason)
               values ($1, $2, 'เหล็ก H-BEAM', $3, 'เส้น', $4, 299.4, $5)`, [id, kg, pieces, pricePerPiece, reason])
      await q(`select public.submit_purchase_request($1)`, [id])
      await q(`select public.record_direct_purchase($1)`, [id])
      return (await q(`select qty_over_boq, price_over_threshold from public.purchase_request_items where pr_id = $1`, [id])).rows[0]
    })

    // 10 เส้น × 8,982 บาท = 2,994 กิโล ที่ 30 บาทต่อกิโล ไม่เกิน BOQ ไม่แพงกว่าต้นทุน
    const ok = await buy(10, 8982, null)
    expect(ok).toEqual({ qty_over_boq: false, price_over_threshold: false })
    let row = (await client.query(`select qty_ordered, qty_received, actual from public.v_boq_item_costs where boq_item_id = $1`, [kg])).rows[0]
    expect(n(row.qty_ordered)).toBeCloseTo(2994, 3)
    expect(n(row.qty_received)).toBeCloseTo(2994, 3)
    expect(n(row.actual)).toBe(89820)

    // อีก 1 เส้นที่ 9,900 บาท: รวม 3,293.4 กิโล เกิน BOQ และ 33.07 บาทต่อกิโล แพงเกิน 5%
    const over = await buy(1, 9900, 'ราคาเหล็กขึ้น')
    expect(over).toEqual({ qty_over_boq: true, price_over_threshold: true })
    row = (await client.query(`select qty_ordered, actual from public.v_boq_item_costs where boq_item_id = $1`, [kg])).rows[0]
    expect(n(row.qty_ordered)).toBeCloseTo(3293.4, 3)
    expect(n(row.actual)).toBe(89820 + 9900)

    // ตัวแปลงต้องมากกว่า 0
    await expect(runAs(client, mgmt, async q => {
      const id = (await q(`insert into public.purchase_requests (pr_no, project_id, requested_by, status, created_by) values (public.next_document_no('PR'), $1, $2, 'draft', $2) returning id`, [projectA, mgmt])).rows[0].id
      await q(`insert into public.purchase_request_items (pr_id, boq_item_id, description, qty, unit, unit_price, qty_factor) values ($1, $2, 'x', 1, 'เส้น', 1, 0)`, [id, kg])
    })).rejects.toThrow(/check constraint/)
  })

  it('ยกเลิกการยืนยัน BOQ ได้เมื่อโครงการยังไม่มีเอกสารต้นทุน แล้วกลับมาแก้ตัวเลขได้', async () => {
    const vB = (await client.query(`select id from public.boq_versions where project_id = $1 and status = 'confirmed'`, [projectB])).rows[0].id
    const itemB = (await client.query(`select id from public.boq_items where boq_version_id = $1 and not is_off_boq`, [vB])).rows[0].id

    // วิศวกรแก้ BOQ ที่ยืนยันแล้วไม่ได้ (RLS ไม่ให้แตะแถว)
    const engRows = await runAs(client, engB, async q => (await q(`update public.boq_items set qty = 2 where id = $1`, [itemB])).rowCount)
    expect(engRows).toBe(0)
    // วิศวกรยกเลิกการยืนยันไม่ได้
    await expect(runAs(client, engB, q => q(`select public.unconfirm_boq_version($1)`, [vB]))).rejects.toThrow(/ฝ่ายบริหาร/)

    await runAs(client, mgmt, q => q(`select public.unconfirm_boq_version($1)`, [vB]))
    const after = (await client.query(`select status, confirmed_by, confirmed_at from public.boq_versions where id = $1`, [vB])).rows[0]
    expect(after.status).toBe('draft')
    expect(after.confirmed_by).toBeNull()
    expect(after.confirmed_at).toBeNull()
    // โครงการไม่เหลือ BOQ ที่ยืนยัน จึงกลับไปเป็นร่าง
    expect((await client.query(`select status from public.projects where id = $1`, [projectB])).rows[0].status).toBe('draft')

    // แก้ตัวเลขได้แล้ว และยืนยันใหม่ได้
    await runAs(client, mgmt, q => q(`update public.boq_items set qty = 2 where id = $1`, [itemB]))
    await runAs(client, mgmt, q => q(`select public.confirm_boq_version($1)`, [vB]))
    expect((await client.query(`select status from public.projects where id = $1`, [projectB])).rows[0].status).toBe('active')
  })

  it('ยกเลิกการยืนยันไม่ได้ถ้าโครงการมีเอกสารต้นทุนแล้ว', async () => {
    const vA = (await client.query(`select id from public.boq_versions where project_id = $1 and status = 'confirmed'`, [projectA])).rows[0].id
    expect(await client.query(`select public.project_has_cost_documents($1) as x`, [projectA]).then(r => r.rows[0].x)).toBe(true)
    await expect(runAs(client, mgmt, q => q(`select public.unconfirm_boq_version($1)`, [vA]))).rejects.toThrow(/เอกสารต้นทุน/)
  })

  it('ลบโครงการ: วิศวกรทำไม่ได้ และโครงการที่มีเอกสารต้นทุนลบไม่ได้แม้เป็นฝ่ายบริหาร', async () => {
    const byEng = await runAs(client, engB, async q => (await q(`delete from public.projects where id = $1`, [projectB])).rowCount ?? 0)
    expect(byEng).toBe(0)
    expect((await client.query(`select count(*)::int as c from public.projects where id = $1`, [projectB])).rows[0].c).toBe(1)

    // โครงการ A มีใบขอซื้อและใบแจ้งหนี้ผูกอยู่ foreign key จึงปฏิเสธ
    await expect(runAs(client, mgmt, q => q(`delete from public.projects where id = $1`, [projectA]))).rejects.toThrow()
    expect((await client.query(`select count(*)::int as c from public.projects where id = $1`, [projectA])).rows[0].c).toBe(1)
  })

  it('ฝ่ายบริหารลบโครงการที่ยังไม่มีเอกสารต้นทุนได้ พร้อม BOQ และสมาชิก', async () => {
    const before = (await client.query(`select count(*)::int as c from public.boq_versions where project_id = $1`, [projectB])).rows[0].c
    expect(before).toBeGreaterThan(0)

    await runAs(client, mgmt, q => q(`delete from public.projects where id = $1`, [projectB]))

    expect((await client.query(`select count(*)::int as c from public.projects where id = $1`, [projectB])).rows[0].c).toBe(0)
    expect((await client.query(`select count(*)::int as c from public.boq_versions where project_id = $1`, [projectB])).rows[0].c).toBe(0)
    expect((await client.query(`select count(*)::int as c from public.project_members where project_id = $1`, [projectB])).rows[0].c).toBe(0)
    // การลบถูกบันทึกใน audit log
    const log = (await client.query(`select action, old_value from public.audit_logs where table_name = 'projects' and record_id = $1 and action = 'DELETE'`, [projectB])).rows
    expect(log).toHaveLength(1)
    expect((log[0].old_value as { code: string }).code).toBe('B')
  })

  it('notifications: อ่านได้เฉพาะของตัวเอง และ insert ผ่าน authenticated ไม่ได้', async () => {
    await client.query(`insert into public.notifications (user_id, event, title) values ($1, 'pr_pending', 'ทดสอบ'), ($2, 'pr_pending', 'ของคนอื่น')`, [engA, engB])
    const mine = await runAs(client, engA, async q => (await q(`select title from public.notifications`)).rows.map(r => r.title))
    expect(mine).toEqual(['ทดสอบ'])
    await expect(runAs(client, engA, q => q(`insert into public.notifications (user_id, event, title) values ($1, 'x', 'spam')`, [engB]))).rejects.toThrow(/row-level security/)
  })
})
