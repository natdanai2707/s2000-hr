-- ============================================================
-- ซื้อเป็นหน่วยอื่นโดยยังไม่ระบุตัวแปลงหน่วย (เช่น ซื้อเป็นชุด แต่ BOQ คิดเป็น m2 และยังไม่รู้ว่า 1 ชุดเท่ากับกี่ m2)
-- qty_factor ว่าง = ยังไม่รู้ ยอดเงินนับเข้าต้นทุนของรายการ BOQ ครบ ผู้ใช้เทียบยอดเงินกับงบและราคาขายเอง
-- ส่วนการเทียบปริมาณ (เกิน BOQ) และราคาต่อหน่วย (แพงกว่าต้นทุน) ข้ามบรรทัดนั้น และไม่นับปริมาณเข้าปริมาณที่สั่งหรือรับ
-- ============================================================

alter table public.purchase_request_items alter column qty_factor drop not null;
alter table public.purchase_order_items alter column qty_factor drop not null;

create or replace function public.submit_purchase_request(p_pr_id uuid)
returns public.pr_status language plpgsql security definer set search_path = public as $$
declare
  v_pr public.purchase_requests%rowtype;
  v_item record;
  v_threshold numeric := public.setting_numeric('price_variance_threshold_pct', 5);
  v_limit numeric := public.setting_numeric('pm_approval_limit', 50000);
  v_qty_rule boolean := public.setting_bool('qty_over_boq_requires_management', true);
  v_total numeric := 0;
  v_any_over boolean := false;
  v_ordered numeric;
begin
  select * into v_pr from public.purchase_requests where id = p_pr_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  -- เจ้าของ, PM/management ของโครงการ หรือ purchasing (กรณีแก้ราคาตอนออก PO แล้วต้องส่งกลับไปอนุมัติใหม่)
  if v_pr.requested_by <> auth.uid() and not public.can_manage_project(v_pr.project_id)
     and public.current_role_name() <> 'purchasing' then
    raise exception 'ไม่มีสิทธิ์ส่งใบขอซื้อนี้';
  end if;
  if v_pr.status not in ('draft', 'rejected') then raise exception 'ใบขอซื้อนี้ส่งแล้ว'; end if;
  if not exists (select 1 from public.purchase_request_items where pr_id = p_pr_id) then
    raise exception 'ใบขอซื้อไม่มีรายการ';
  end if;

  for v_item in
    select pri.id, pri.qty, pri.unit_price, pri.qty_factor, pri.variance_reason, b.qty as boq_qty, b.unit_cost, b.is_off_boq
      from public.purchase_request_items pri
      join public.boq_items b on b.id = pri.boq_item_id
     where pri.pr_id = p_pr_id
  loop
    -- ปริมาณที่สั่งแล้ว (PO ที่ไม่ยกเลิก) + PR อื่นที่กำลังรอ/อนุมัติแล้วแต่ยังไม่เป็น PO
    select coalesce(sum(poi.qty * poi.qty_factor), 0) into v_ordered
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
     where poi.boq_item_id = (select boq_item_id from public.purchase_request_items where id = v_item.id)
       and po.status <> 'cancelled';

    declare
      -- ตัวแปลงหน่วยว่าง = ยังไม่รู้ว่าหน่วยที่ซื้อเท่ากับกี่หน่วย BOQ เทียบปริมาณและราคาต่อหน่วยไม่ได้ จึงไม่ตั้งธง
      v_over_qty boolean := coalesce((not v_item.is_off_boq) and (v_ordered + v_item.qty * v_item.qty_factor > v_item.boq_qty), false);
      v_over_price boolean := coalesce((not v_item.is_off_boq) and v_item.boq_qty > 0
                              and v_item.unit_price / v_item.qty_factor > v_item.unit_cost * (1 + v_threshold / 100), false);
    begin
      if (v_over_qty or v_over_price or v_item.is_off_boq) and coalesce(trim(v_item.variance_reason), '') = '' then
        raise exception 'ต้องระบุเหตุผลสำหรับรายการที่เกิน BOQ หรือเกินราคาที่ทดไว้';
      end if;
      update public.purchase_request_items
         set qty_over_boq = v_over_qty, price_over_threshold = v_over_price
       where id = v_item.id;
      if v_over_qty or v_item.is_off_boq then v_any_over := true; end if;
    end;
    v_total := v_total + v_item.qty * v_item.unit_price;
  end loop;

  update public.purchase_requests
     set total_amount = v_total,
         requires_management = (v_total > v_limit) or (v_qty_rule and v_any_over),
         status = 'pending_pm',
         submitted_at = now()
   where id = p_pr_id;

  return 'pending_pm';
end $$;

create or replace view public.v_boq_item_costs
with (security_invoker = true) as
with po_qty as (
  -- ปริมาณและมูลค่าที่สั่งแล้ว (PO ที่ไม่ยกเลิก) ต่อรายการ PO
  select poi.id as po_item_id, poi.boq_item_id, poi.po_id, poi.qty, poi.unit_price, poi.qty_factor
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
         sum(pq.qty * pq.qty_factor) as qty_ordered
    from po_qty pq left join gr_per_po_item g on g.po_item_id = pq.po_item_id
   group by pq.boq_item_id
),
received as (
  -- ปริมาณรับเป็นหน่วยของ BOQ (คูณตัวแปลงหน่วยของรายการ PO) เงินคิดตามหน่วยที่ซื้อจริง
  select gri.boq_item_id,
         -- ตัวแปลงหน่วยว่าง ไม่นับปริมาณ (ไม่รู้ว่าเท่ากับกี่หน่วย BOQ) แต่ยอดเงินยังนับครบ
         sum(case when gri.po_item_id is null then gri.qty_received else gri.qty_received * poi.qty_factor end) as qty_received,
         sum(gri.qty_received * gri.unit_cost) as actual
    from public.goods_receipt_items gri
    left join public.purchase_order_items poi on poi.id = gri.po_item_id
   group by gri.boq_item_id
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
