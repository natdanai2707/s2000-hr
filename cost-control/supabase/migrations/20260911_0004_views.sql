-- ============================================================
-- Views: ตัวเลข 4 ชั้นต่อรายการ BOQ และสรุปต่อโครงการ
-- คำนวณจากเอกสารต้นทางเท่านั้น ห้ามเก็บเป็นค่าที่แก้มือได้
-- view ใช้ security_invoker เพื่อให้ RLS ของตารางต้นทางมีผล
-- ============================================================

create or replace view public.v_boq_item_costs
with (security_invoker = true) as
with po_qty as (
  -- ปริมาณและมูลค่าที่สั่งแล้ว (PO ที่ไม่ยกเลิก) ต่อรายการ PO
  select poi.id as po_item_id, poi.boq_item_id, poi.po_id, poi.qty, poi.unit_price
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.po_id
   where po.status <> 'cancelled'
),
gr_per_po_item as (
  select po_item_id, sum(qty_received) as qty_received, sum(qty_received * unit_cost) as amount
    from public.goods_receipt_items group by po_item_id
),
committed as (
  -- ยังไม่รับของ = (qty สั่ง − qty รับ) × ราคา PO
  select pq.boq_item_id,
         sum(greatest(pq.qty - coalesce(g.qty_received, 0), 0) * pq.unit_price) as committed,
         sum(pq.qty) as qty_ordered
    from po_qty pq left join gr_per_po_item g on g.po_item_id = pq.po_item_id
   group by pq.boq_item_id
),
received as (
  select boq_item_id, sum(qty_received) as qty_received, sum(qty_received * unit_cost) as actual
    from public.goods_receipt_items group by boq_item_id
),
expense_sum as (
  select boq_item_id, sum(amount) as amount from public.expenses group by boq_item_id
),
wcc_sum as (
  -- งวดงานผู้รับเหมาช่วงที่รับรองแล้ว นับเป็น actual ของรายการ BOQ
  select a.boq_item_id, sum(w.amount) as amount
    from public.work_completion_certificates w
    join public.subcontract_agreements a on a.id = w.agreement_id
   where w.certified_at is not null
   group by a.boq_item_id
),
po_paid as (
  select i.po_id, sum(p.amount) as paid
    from public.invoices i join public.payments p on p.invoice_id = i.id
   where i.po_id is not null group by i.po_id
),
po_total as (
  select po_id, sum(qty * unit_price) as total from public.purchase_order_items group by po_id
),
po_item_paid as (
  -- กระจายยอดชำระของ PO ลงรายการ BOQ ตามสัดส่วนมูลค่ารายการใน PO
  select poi.boq_item_id,
         sum(pp.paid * (poi.qty * poi.unit_price) / nullif(pt.total, 0)) as paid
    from public.purchase_order_items poi
    join po_paid pp on pp.po_id = poi.po_id
    join po_total pt on pt.po_id = poi.po_id
   group by poi.boq_item_id
),
agreement_paid as (
  select a.boq_item_id, sum(p.amount) as paid
    from public.invoices i
    join public.payments p on p.invoice_id = i.id
    join public.subcontract_agreements a on a.id = i.agreement_id
   where i.agreement_id is not null
   group by a.boq_item_id
)
select b.id as boq_item_id,
       b.boq_version_id,
       v.project_id,
       b.section_id,
       b.item_no, b.description, b.unit, b.category, b.is_off_boq,
       b.qty, b.unit_cost, b.sell_unit_price,
       round(b.qty * b.unit_cost, 2) as budget,
       round(b.qty * b.sell_unit_price, 2) as sell_total,
       round(coalesce(c.committed, 0), 2) as committed,
       round(coalesce(r.actual, 0) + coalesce(e.amount, 0) + coalesce(w.amount, 0), 2) as actual,
       round(coalesce(pip.paid, 0) + coalesce(e.amount, 0) + coalesce(ap.paid, 0), 2) as paid,
       coalesce(c.qty_ordered, 0) as qty_ordered,
       coalesce(r.qty_received, 0) as qty_received,
       b.qty - coalesce(c.qty_ordered, 0) as qty_remaining
  from public.boq_items b
  join public.boq_versions v on v.id = b.boq_version_id
  left join committed c on c.boq_item_id = b.id
  left join received r on r.boq_item_id = b.id
  left join expense_sum e on e.boq_item_id = b.id
  left join wcc_sum w on w.boq_item_id = b.id
  left join po_item_paid pip on pip.boq_item_id = b.id
  left join agreement_paid ap on ap.boq_item_id = b.id;

create or replace view public.v_project_summary
with (security_invoker = true) as
with cur as (
  select p.id as project_id, v.id as version_id
    from public.projects p
    left join public.boq_versions v on v.project_id = p.id and v.status = 'confirmed'
),
agg as (
  select c.project_id,
         sum(x.budget) as total_budget,
         sum(x.sell_total) - sum(x.budget) as expected_profit,
         sum(x.committed) as committed,
         sum(x.actual) as actual,
         sum(x.paid) as paid,
         -- budget ของส่วนที่ยังไม่สั่ง = (qty − qty สั่งแล้ว) × unit_cost
         sum(greatest(x.qty - x.qty_ordered, 0) * x.unit_cost) as unordered_budget
    from cur c
    join public.v_boq_item_costs x on x.boq_version_id = c.version_id
   group by c.project_id
)
select p.id as project_id, p.code, p.name, p.customer_name, p.branch_id, p.status,
       p.contract_value, p.start_date, p.planned_end_date, p.actual_end_date,
       cur.version_id as confirmed_version_id,
       round(coalesce(a.total_budget, 0), 2) as total_budget,
       round(coalesce(a.expected_profit, 0), 2) as expected_profit,
       round(coalesce(a.committed, 0), 2) as committed,
       round(coalesce(a.actual, 0), 2) as actual,
       round(coalesce(a.paid, 0), 2) as paid,
       case when coalesce(a.total_budget, 0) > 0
            then round(coalesce(a.actual, 0) / a.total_budget * 100, 2) else null end as cost_pct,
       null::numeric as progress_pct,          -- เฟส 2
       null::numeric as cost_vs_progress,      -- เฟส 2
       round(p.contract_value - (coalesce(a.actual, 0) + coalesce(a.committed, 0) + coalesce(a.unordered_budget, 0)), 2) as forecast_profit,
       (p.planned_end_date - (now() at time zone 'Asia/Bangkok')::date) as days_remaining
  from public.projects p
  join cur on cur.project_id = p.id
  left join agg a on a.project_id = p.id;

-- สรุปต่อหมวด (ใช้ในหน้า BOQ version และหน้าโครงการ)
create or replace view public.v_boq_section_summary
with (security_invoker = true) as
select x.boq_version_id, x.project_id, x.section_id, s.name as section_name, s.sort_order,
       sum(x.budget) as budget, sum(x.sell_total) as sell_total,
       sum(x.sell_total) - sum(x.budget) as expected_profit,
       sum(x.committed) as committed, sum(x.actual) as actual, sum(x.paid) as paid
  from public.v_boq_item_costs x
  left join public.boq_sections s on s.id = x.section_id
 group by x.boq_version_id, x.project_id, x.section_id, s.name, s.sort_order;
