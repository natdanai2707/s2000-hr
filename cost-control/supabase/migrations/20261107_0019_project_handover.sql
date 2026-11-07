-- จบงานแล้วยังวางบิลและรับเงินต่อได้ สถานะ closing คือ งานเสร็จแล้ว (หน้างานจบ) closed คือ ปิดโครงการ (เก็บเงินครบ)
-- บันทึกวันที่ส่งงานให้ลูกค้าแยกจากวันที่งานเสร็จ เพราะงานเสร็จก่อนส่งมอบได้
alter table public.projects add column if not exists handover_date date;

comment on column public.projects.actual_end_date is 'วันที่งานหน้างานเสร็จจริง';
comment on column public.projects.handover_date is 'วันที่ส่งมอบงานให้ลูกค้า ว่างคือยังไม่ส่งงาน';

-- เพิ่มสถานะ วันเสร็จ และวันส่งงานต่อท้าย view รายรับ ให้หน้างานเสร็จแล้วอ่านครั้งเดียวได้ครบ
create or replace view public.v_project_receivables
with (security_invoker = true) as
select p.id as project_id, p.code, p.name, p.contract_value,
       coalesce(b.billed, 0) as billed_excl_vat,
       coalesce(b.billed_total, 0) as billed_total,
       coalesce(b.outstanding, 0) as outstanding,
       coalesce(rc.cash, 0) as cash_received,
       coalesce(rc.wht, 0) as withholding_tax,
       coalesce(rc.retention, 0) - coalesce(rc.released, 0) as retention_held,
       case when p.contract_value > 0 then round(coalesce(b.billed, 0) / p.contract_value * 100, 2) end as billed_pct,
       p.status, p.actual_end_date, p.handover_date
  from public.projects p
  left join (
    select project_id, sum(amount) as billed, sum(total) as billed_total, sum(outstanding) as outstanding
      from public.v_customer_billing_status where voided_at is null group by project_id
  ) b on b.project_id = p.id
  left join (
    select project_id, sum(amount_received) as cash, sum(withholding_tax) as wht, sum(retention) as retention,
           sum(amount_received) filter (where is_retention_release) as released
      from public.customer_receipts group by project_id
  ) rc on rc.project_id = p.id;
