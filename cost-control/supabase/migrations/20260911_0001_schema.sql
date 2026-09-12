-- ============================================================
-- S-2000 Project Cost Control: schema เฟส 1
-- ตารางทั้งหมดใช้ uuid เป็น primary key มี created_at, updated_at, created_by
-- ตัวเลข 4 ชั้น (budget / committed / actual / paid) ไม่เก็บในตาราง
-- คำนวณจาก view v_boq_item_costs และ v_project_summary เท่านั้น
-- รันไฟล์นี้ใน Supabase SQL Editor ตามลำดับเลขไฟล์
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
create type public.user_role as enum (
  'engineer', 'site_supervisor', 'project_manager', 'purchasing', 'accounting', 'management', 'admin'
);
create type public.project_status as enum ('draft', 'active', 'closing', 'closed');
create type public.boq_version_type as enum ('quotation', 'confirmed', 'variation_order');
create type public.boq_version_status as enum ('draft', 'confirmed', 'superseded');
create type public.boq_category as enum ('material', 'labor', 'subcontract', 'equipment', 'other');
create type public.pr_status as enum (
  'draft', 'pending_pm', 'pending_management', 'approved', 'rejected', 'cancelled'
);
create type public.approval_decision as enum ('approved', 'rejected');
create type public.po_status as enum ('issued', 'partially_received', 'received', 'cancelled');
create type public.receipt_source as enum ('supplier', 'internal_stock');
create type public.invoice_status as enum ('received', 'approved', 'paid');
create type public.issue_category as enum (
  'design', 'material', 'labor', 'subcontractor', 'customer', 'safety', 'schedule', 'cost', 'other'
);
create type public.issue_status as enum ('open', 'resolved');
create type public.agreement_status as enum ('active', 'completed', 'terminated');

-- ---------- helper: updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- หน่วยงานและผู้ใช้ ----------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'engineer',
  branch_id uuid references public.branches (id),
  line_user_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- โครงการ ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  customer_name text,
  branch_id uuid not null references public.branches (id),
  contract_value numeric(14,2) not null default 0,
  start_date date,
  planned_end_date date,
  actual_end_date date,
  status public.project_status not null default 'draft',
  retention_pct numeric(5,2) not null default 0,
  penalty_per_day numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_in_project text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  primary key (project_id, user_id)
);

-- ---------- BOQ ----------
create table public.boq_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_no integer not null,
  type public.boq_version_type not null default 'quotation',
  status public.boq_version_status not null default 'draft',
  source_file_path text,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  unique (project_id, version_no)
);
-- โครงการมี version ที่ confirmed ได้ครั้งละหนึ่ง
create unique index boq_versions_one_confirmed
  on public.boq_versions (project_id) where status = 'confirmed';

create table public.boq_sections (
  id uuid primary key default gen_random_uuid(),
  boq_version_id uuid not null references public.boq_versions (id) on delete cascade,
  code text,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table public.boq_items (
  id uuid primary key default gen_random_uuid(),
  boq_version_id uuid not null references public.boq_versions (id) on delete cascade,
  section_id uuid references public.boq_sections (id) on delete set null,
  item_no text,
  description text not null,
  unit text,
  qty numeric(14,3) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  category public.boq_category not null default 'material',
  markup_pct numeric(6,2) not null default 0,
  sell_unit_price numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  is_off_boq boolean not null default false,
  -- ใช้ตาม VO: รายการที่ copy มาจาก version ก่อนหน้า
  origin_item_id uuid references public.boq_items (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index boq_items_version_idx on public.boq_items (boq_version_id);
create index boq_items_section_idx on public.boq_items (section_id);

-- template การจับคู่คอลัมน์ตอนนำเข้า xlsx ตามชื่อชีต
create table public.boq_import_templates (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null unique,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- ---------- ซัพพลายเออร์ ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  phone text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- ---------- ใบขอซื้อ ----------
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  pr_no text not null unique,
  project_id uuid not null references public.projects (id),
  requested_by uuid not null references public.profiles (id),
  status public.pr_status not null default 'draft',
  needed_by_date date,
  note text,
  -- เก็บผลการประเมินตอนส่ง เพื่อให้ routing ตรวจสอบย้อนหลังได้
  total_amount numeric(14,2) not null default 0,
  requires_management boolean not null default false,
  submitted_at timestamptz,
  client_ref text, -- id ฝั่ง offline queue กันส่งซ้ำ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create unique index purchase_requests_client_ref on public.purchase_requests (client_ref) where client_ref is not null;
create index purchase_requests_project_idx on public.purchase_requests (project_id);
create index purchase_requests_status_idx on public.purchase_requests (status);

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requests (id) on delete cascade,
  boq_item_id uuid not null references public.boq_items (id),
  description text not null,
  qty numeric(14,3) not null,
  unit text,
  unit_price numeric(14,2) not null default 0,
  supplier_name text,
  supplier_id uuid references public.suppliers (id),
  variance_reason text,
  qty_over_boq boolean not null default false,
  price_over_threshold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index pr_items_pr_idx on public.purchase_request_items (pr_id);
create index pr_items_boq_idx on public.purchase_request_items (boq_item_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  document_type text not null, -- purchase_request / boq_version / purchase_order
  document_id uuid not null,
  step text not null,          -- pm / management
  approver_id uuid not null references public.profiles (id),
  decision public.approval_decision not null,
  comment text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index approvals_doc_idx on public.approvals (document_type, document_id);

-- ---------- ใบสั่งซื้อ ----------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique,
  project_id uuid not null references public.projects (id),
  pr_id uuid references public.purchase_requests (id),
  supplier_id uuid references public.suppliers (id),
  status public.po_status not null default 'issued',
  issued_at timestamptz not null default now(),
  total_amount numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index po_project_idx on public.purchase_orders (project_id);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  boq_item_id uuid not null references public.boq_items (id),
  pr_item_id uuid references public.purchase_request_items (id),
  description text,
  qty numeric(14,3) not null,
  unit text,
  unit_price numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index po_items_po_idx on public.purchase_order_items (po_id);
create index po_items_boq_idx on public.purchase_order_items (boq_item_id);

-- ---------- รับของ ----------
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id),
  received_by uuid not null references public.profiles (id),
  received_at timestamptz not null default now(),
  source public.receipt_source not null default 'supplier',
  note text,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index goods_receipts_po_idx on public.goods_receipts (po_id);

create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts (id) on delete cascade,
  po_item_id uuid not null references public.purchase_order_items (id),
  boq_item_id uuid not null references public.boq_items (id),
  qty_received numeric(14,3) not null,
  unit_cost numeric(14,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index gr_items_receipt_idx on public.goods_receipt_items (receipt_id);
create index gr_items_boq_idx on public.goods_receipt_items (boq_item_id);
create index gr_items_po_item_idx on public.goods_receipt_items (po_item_id);

-- ---------- ผู้รับเหมาช่วง (สร้างตารางไว้ก่อน ใช้งานเฟส 2) ----------
create table public.subcontract_agreements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  supplier_id uuid not null references public.suppliers (id),
  boq_item_id uuid not null references public.boq_items (id),
  contract_amount numeric(14,2) not null default 0,
  retention_pct numeric(5,2) not null default 0,
  penalty_per_day numeric(12,2) not null default 0,
  status public.agreement_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table public.work_completion_certificates (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.subcontract_agreements (id) on delete cascade,
  period_no integer not null,
  pct_complete numeric(5,2) not null default 0,
  amount numeric(14,2) not null default 0,
  retention_deducted numeric(14,2) not null default 0,
  penalty_deducted numeric(14,2) not null default 0,
  certified_by uuid references public.profiles (id),
  certified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- ---------- ใบแจ้งหนี้และชำระเงิน ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id),
  project_id uuid not null references public.projects (id),
  po_id uuid references public.purchase_orders (id),
  agreement_id uuid references public.subcontract_agreements (id),
  invoice_no text not null,
  invoice_date date not null,
  amount numeric(14,2) not null,
  due_date date,
  status public.invoice_status not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint invoices_link check (po_id is not null or agreement_id is not null)
);
create index invoices_project_idx on public.invoices (project_id);
create index invoices_po_idx on public.invoices (po_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  paid_at date not null,
  amount numeric(14,2) not null,
  method text,
  reference_no text,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index payments_invoice_idx on public.payments (invoice_id);

-- ---------- ค่าใช้จ่ายเบ็ดเตล็ด ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  boq_item_id uuid not null references public.boq_items (id),
  expense_date date not null,
  amount numeric(14,2) not null,
  description text not null,
  paid_by uuid references public.profiles (id),
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index expenses_project_idx on public.expenses (project_id);
create index expenses_boq_idx on public.expenses (boq_item_id);

-- ---------- ระบบ ----------
create table public.settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);
create index notifications_user_idx on public.notifications (user_id, read_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

-- ---------- เลขเอกสารรายเดือน ----------
create table public.document_counters (
  doc_type text not null,
  period text not null,
  last_no integer not null default 0,
  primary key (doc_type, period)
);

create or replace function public.next_document_no(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  v_no integer;
begin
  insert into public.document_counters (doc_type, period, last_no)
  values (p_type, v_period, 1)
  on conflict (doc_type, period) do update set last_no = document_counters.last_no + 1
  returning last_no into v_no;
  return p_type || '-' || v_period || '-' || lpad(v_no::text, 4, '0');
end $$;

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  for t in select unnest(array[
    'branches','profiles','projects','project_members','boq_versions','boq_sections','boq_items',
    'boq_import_templates','suppliers','purchase_requests','purchase_request_items','approvals',
    'purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'subcontract_agreements','work_completion_certificates','invoices','payments','expenses',
    'settings','notifications'])
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- สร้าง profile อัตโนมัติเมื่อมี auth user ใหม่ ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, branch_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'engineer'),
    (new.raw_user_meta_data ->> 'branch_id')::uuid
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- seed ค่าคงที่ ----------
insert into public.branches (code, name) values
  ('ASIA', 'เอเชีย'), ('DMK', 'ดอนเมือง'), ('BPR', 'บ้านพรุ')
on conflict (code) do nothing;

insert into public.settings (key, value) values
  ('price_variance_threshold_pct', '5'::jsonb),
  ('pm_approval_limit', '50000'::jsonb),
  ('qty_over_boq_requires_management', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------- Storage bucket สำหรับไฟล์ BOQ และเอกสารแนบ (private) ----------
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;
