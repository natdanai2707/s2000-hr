-- ============================================================
-- รายรับของโครงการ: การวางบิลลูกค้า และเงินเข้าจริง
-- วางบิล = ยอดที่เรียกเก็บลูกค้าแต่ละงวด (ไม่รวม VAT + VAT) งานของฝ่ายบัญชี
-- รับเงิน = เงินเข้าบัญชีจริง พร้อมยอดที่ลูกค้าหักไว้ (ภาษีหัก ณ ที่จ่าย เงินประกันผลงาน อื่นๆ)
-- บิลหนึ่งใบรับเงินได้หลายครั้ง บิลปิดเมื่อ เงินเข้า + ยอดที่ถูกหัก ครบยอดรวม VAT
-- บันทึกและแก้ไขได้: บัญชี ฝ่ายบริหาร ผู้ดูแลระบบ ดูได้: ผู้ที่เห็นโครงการ
-- ============================================================

create table if not exists public.customer_billings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  billing_no text not null unique,
  installment text, -- งวดที่ หรือรายละเอียด เช่น งวดที่ 2 งานติดตั้งหลังคา 40%
  billed_date date not null,
  due_date date,
  amount numeric(14,2) not null check (amount > 0), -- ไม่รวม VAT
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  note text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index if not exists customer_billings_project_idx on public.customer_billings (project_id);

create table if not exists public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  billing_id uuid references public.customer_billings (id), -- null = เงินเข้าที่ไม่ได้ผูกบิล เช่น คืนเงินประกันผลงาน
  received_date date not null,
  amount_received numeric(14,2) not null default 0 check (amount_received >= 0), -- เงินเข้าบัญชีจริง
  withholding_tax numeric(14,2) not null default 0 check (withholding_tax >= 0),
  retention numeric(14,2) not null default 0 check (retention >= 0), -- เงินประกันผลงานที่ลูกค้าหักไว้
  other_deduction numeric(14,2) not null default 0 check (other_deduction >= 0),
  -- ลูกค้าคืนเงินประกันผลงานที่หักไว้ ไม่ผูกบิล นับเป็นเงินเข้าและลดยอดเงินประกันที่ยังค้าง
  is_retention_release boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  check (amount_received + withholding_tax + retention + other_deduction > 0),
  check (not is_retention_release or (billing_id is null and withholding_tax = 0 and retention = 0 and other_deduction = 0))
);
create index if not exists customer_receipts_project_idx on public.customer_receipts (project_id);
create index if not exists customer_receipts_billing_idx on public.customer_receipts (billing_id);

-- รับเงินของบิลต้องเป็นโครงการเดียวกับบิล และบิลที่ยกเลิกแล้วรับเงินไม่ได้
create or replace function public.customer_receipt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bill public.customer_billings%rowtype;
begin
  if new.billing_id is not null then
    select * into v_bill from public.customer_billings where id = new.billing_id;
    if not found then raise exception 'ไม่พบใบวางบิล'; end if;
    if v_bill.voided_at is not null then raise exception 'ใบวางบิลนี้ยกเลิกแล้ว'; end if;
    new.project_id := v_bill.project_id;
  end if;
  return new;
end $$;

drop trigger if exists customer_receipts_guard on public.customer_receipts;
create trigger customer_receipts_guard
  before insert or update of billing_id, project_id on public.customer_receipts
  for each row execute function public.customer_receipt_guard();

-- ยกเลิกบิลที่มีการรับเงินแล้วไม่ได้ ต้องลบรายการรับเงินก่อน
create or replace function public.customer_billing_void_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null
     and exists (select 1 from public.customer_receipts where billing_id = new.id) then
    raise exception 'ใบวางบิลนี้มีการรับเงินแล้ว ลบรายการรับเงินก่อนยกเลิก';
  end if;
  return new;
end $$;

drop trigger if exists customer_billings_void_guard on public.customer_billings;
create trigger customer_billings_void_guard
  before update of voided_at on public.customer_billings
  for each row execute function public.customer_billing_void_guard();

do $$
declare t text;
begin
  for t in select unnest(array['customer_billings', 'customer_receipts']) loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

alter table public.customer_billings enable row level security;
alter table public.customer_receipts enable row level security;

drop policy if exists customer_billings_select on public.customer_billings;
create policy customer_billings_select on public.customer_billings for select to authenticated
  using (public.can_view_project(project_id));
drop policy if exists customer_billings_write on public.customer_billings;
create policy customer_billings_write on public.customer_billings for all to authenticated
  using (public.current_role_name() in ('accounting', 'management', 'admin'))
  with check (public.current_role_name() in ('accounting', 'management', 'admin'));

drop policy if exists customer_receipts_select on public.customer_receipts;
create policy customer_receipts_select on public.customer_receipts for select to authenticated
  using (public.can_view_project(project_id));
drop policy if exists customer_receipts_write on public.customer_receipts;
create policy customer_receipts_write on public.customer_receipts for all to authenticated
  using (public.current_role_name() in ('accounting', 'management', 'admin'))
  with check (public.current_role_name() in ('accounting', 'management', 'admin'));

-- ยอดของแต่ละบิล: รับแล้ว (เงินเข้า + ยอดที่ถูกหัก) และคงค้าง ไม่นับบิลที่ยกเลิก
create or replace view public.v_customer_billing_status
with (security_invoker = true) as
select b.id as billing_id, b.project_id, b.billing_no, b.installment, b.billed_date, b.due_date,
       b.amount, b.vat_amount, b.amount + b.vat_amount as total, b.note, b.voided_at, b.void_reason,
       coalesce(r.cash, 0) as cash_received,
       coalesce(r.wht, 0) as withholding_tax,
       coalesce(r.retention, 0) as retention,
       coalesce(r.other, 0) as other_deduction,
       coalesce(r.cash, 0) + coalesce(r.wht, 0) + coalesce(r.retention, 0) + coalesce(r.other, 0) as settled,
       case when b.voided_at is not null then 0
            else greatest(b.amount + b.vat_amount - (coalesce(r.cash, 0) + coalesce(r.wht, 0) + coalesce(r.retention, 0) + coalesce(r.other, 0)), 0)
       end as outstanding,
       r.last_received
  from public.customer_billings b
  left join (
    select billing_id, sum(amount_received) as cash, sum(withholding_tax) as wht, sum(retention) as retention,
           sum(other_deduction) as other, max(received_date) as last_received
      from public.customer_receipts where billing_id is not null group by billing_id
  ) r on r.billing_id = b.id;

-- รายรับของแต่ละโครงการ: วางบิลแล้วกี่ % ของมูลค่าสัญญา เงินเข้าจริงเท่าไร ค้างรับเท่าไร
create or replace view public.v_project_receivables
with (security_invoker = true) as
select p.id as project_id, p.code, p.name, p.contract_value,
       coalesce(b.billed, 0) as billed_excl_vat,
       coalesce(b.billed_total, 0) as billed_total,
       coalesce(b.outstanding, 0) as outstanding,
       coalesce(rc.cash, 0) as cash_received,
       coalesce(rc.wht, 0) as withholding_tax,
       coalesce(rc.retention, 0) - coalesce(rc.released, 0) as retention_held,
       case when p.contract_value > 0 then round(coalesce(b.billed, 0) / p.contract_value * 100, 2) end as billed_pct
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
