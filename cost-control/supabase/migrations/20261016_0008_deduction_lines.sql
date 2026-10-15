-- ============================================================
-- งานลดใน VO: นำเข้าเป็นรายการ BOQ ที่ปริมาณติดลบ
-- 1. รายการติดลบผูกต้นทุนไม่ได้ (ขอซื้อ สั่งซื้อ รับของ ค่าใช้จ่าย สัญญาผู้รับเหมาช่วง)
--    บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนในหน้าจอ
-- 2. ต้นทุนคาดการณ์ของโครงการหักงานลดออก
-- ============================================================

create or replace function public.guard_deduction_item()
returns trigger
language plpgsql
-- security definer เพื่อให้อ่านปริมาณของรายการได้เสมอ แม้ RLS ของผู้บันทึกจะมองไม่เห็นรายการนั้น
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  select item_no, description, qty into v_item from public.boq_items where id = new.boq_item_id;
  if v_item.qty < 0 then
    raise exception 'รายการ "%" เป็นงานลด (ปริมาณติดลบ) ใช้บันทึกต้นทุนไม่ได้',
      coalesce(v_item.item_no || ' ', '') || v_item.description
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_request_items_deduction_guard on public.purchase_request_items;
create trigger purchase_request_items_deduction_guard
  before insert or update of boq_item_id on public.purchase_request_items
  for each row execute function public.guard_deduction_item();

drop trigger if exists purchase_order_items_deduction_guard on public.purchase_order_items;
create trigger purchase_order_items_deduction_guard
  before insert or update of boq_item_id on public.purchase_order_items
  for each row execute function public.guard_deduction_item();

drop trigger if exists goods_receipt_items_deduction_guard on public.goods_receipt_items;
create trigger goods_receipt_items_deduction_guard
  before insert or update of boq_item_id on public.goods_receipt_items
  for each row execute function public.guard_deduction_item();

drop trigger if exists expenses_deduction_guard on public.expenses;
create trigger expenses_deduction_guard
  before insert or update of boq_item_id on public.expenses
  for each row execute function public.guard_deduction_item();

drop trigger if exists subcontract_agreements_deduction_guard on public.subcontract_agreements;
create trigger subcontract_agreements_deduction_guard
  before insert or update of boq_item_id on public.subcontract_agreements
  for each row execute function public.guard_deduction_item();

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
         -- รายการงานลด (qty ติดลบ) หักออกเต็มจำนวน เพราะเป็นงานที่ไม่ต้องทำแล้ว และสั่งซื้อไม่ได้
         sum(case when x.qty < 0 then x.qty * x.unit_cost
                  else greatest(x.qty - x.qty_ordered, 0) * x.unit_cost end) as unordered_budget
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
