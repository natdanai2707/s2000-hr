-- ============================================================
-- Row Level Security ทุกตาราง
-- หลัก: ดูได้เฉพาะโครงการที่เป็นสมาชิก (management/admin/purchasing/accounting ดูทุกโครงการ)
-- การเปลี่ยนสถานะเอกสารสำคัญทำผ่านฟังก์ชัน security definer ใน 0002 ซึ่งตรวจสิทธิ์เอง
-- ============================================================

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.boq_versions enable row level security;
alter table public.boq_sections enable row level security;
alter table public.boq_items enable row level security;
alter table public.boq_import_templates enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.approvals enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.subcontract_agreements enable row level security;
alter table public.work_completion_certificates enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.document_counters enable row level security;

-- helper: project ของ boq_version / pr / po / receipt / invoice
create or replace function public.project_of_version(p_version_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.boq_versions where id = p_version_id
$$;
create or replace function public.project_of_boq_item(p_item_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select v.project_id from public.boq_items i join public.boq_versions v on v.id = i.boq_version_id where i.id = p_item_id
$$;
create or replace function public.project_of_pr(p_pr_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.purchase_requests where id = p_pr_id
$$;
create or replace function public.project_of_po(p_po_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.purchase_orders where id = p_po_id
$$;
create or replace function public.project_of_receipt(p_receipt_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select po.project_id from public.goods_receipts r join public.purchase_orders po on po.id = r.po_id where r.id = p_receipt_id
$$;
create or replace function public.project_of_invoice(p_invoice_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.invoices where id = p_invoice_id
$$;
create or replace function public.project_of_agreement(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.subcontract_agreements where id = p_id
$$;
create or replace function public.pr_owner(p_pr_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select requested_by from public.purchase_requests where id = p_pr_id
$$;
create or replace function public.pr_status_of(p_pr_id uuid)
returns public.pr_status language sql stable security definer set search_path = public as $$
  select status from public.purchase_requests where id = p_pr_id
$$;

-- ---------- branches ----------
create policy branches_select on public.branches for select to authenticated using (true);
create policy branches_write on public.branches for all to authenticated
  using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.current_role_name() = 'admin')
  with check (id = auth.uid() or public.current_role_name() = 'admin');
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (public.current_role_name() = 'admin');

-- ---------- projects ----------
create policy projects_select on public.projects for select to authenticated
  using (public.can_view_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.current_role_name() in ('management', 'admin', 'project_manager'));
create policy projects_update on public.projects for update to authenticated
  using (public.can_manage_project(id)) with check (public.can_manage_project(id));

-- ---------- project_members ----------
create policy project_members_select on public.project_members for select to authenticated
  using (public.can_view_project(project_id));
create policy project_members_write on public.project_members for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- ---------- boq ----------
create policy boq_versions_select on public.boq_versions for select to authenticated
  using (public.can_view_project(project_id));
create policy boq_versions_insert on public.boq_versions for insert to authenticated
  with check (public.can_manage_project(project_id));
create policy boq_versions_update on public.boq_versions for update to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy boq_versions_delete on public.boq_versions for delete to authenticated
  using (public.can_manage_project(project_id) and status = 'draft');

create policy boq_sections_select on public.boq_sections for select to authenticated
  using (public.can_view_project(public.project_of_version(boq_version_id)));
create policy boq_sections_write on public.boq_sections for all to authenticated
  using (public.can_manage_project(public.project_of_version(boq_version_id)))
  with check (public.can_manage_project(public.project_of_version(boq_version_id)));

create policy boq_items_select on public.boq_items for select to authenticated
  using (public.can_view_project(public.project_of_version(boq_version_id)));
create policy boq_items_write on public.boq_items for all to authenticated
  using (public.can_manage_project(public.project_of_version(boq_version_id)))
  with check (public.can_manage_project(public.project_of_version(boq_version_id)));

create policy boq_templates_select on public.boq_import_templates for select to authenticated using (true);
create policy boq_templates_write on public.boq_import_templates for all to authenticated
  using (public.current_role_name() in ('project_manager', 'management', 'admin'))
  with check (public.current_role_name() in ('project_manager', 'management', 'admin'));

-- ---------- suppliers ----------
create policy suppliers_select on public.suppliers for select to authenticated using (true);
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.current_role_name() in ('purchasing', 'management', 'admin'))
  with check (public.current_role_name() in ('purchasing', 'management', 'admin'));

-- ---------- purchase_requests ----------
create policy pr_select on public.purchase_requests for select to authenticated
  using (public.can_view_project(project_id));
-- สมาชิกโครงการทุกคนสร้าง PR ได้ (requested_by ต้องเป็นตัวเอง)
create policy pr_insert on public.purchase_requests for insert to authenticated
  with check (requested_by = auth.uid() and public.is_project_member(project_id)
              and status = 'draft');
-- เจ้าของแก้ได้ตอนร่าง/ถูกปฏิเสธ และยกเลิกตอนรออนุมัติ; PM/management แก้ได้
create policy pr_update on public.purchase_requests for update to authenticated
  using ((requested_by = auth.uid() and status in ('draft', 'rejected', 'pending_pm', 'pending_management'))
         or public.can_manage_project(project_id))
  with check ((requested_by = auth.uid() and status in ('draft', 'rejected', 'cancelled'))
              or public.can_manage_project(project_id));
create policy pr_delete on public.purchase_requests for delete to authenticated
  using (requested_by = auth.uid() and status = 'draft');

create policy pr_items_select on public.purchase_request_items for select to authenticated
  using (public.can_view_project(public.project_of_pr(pr_id)));
create policy pr_items_write on public.purchase_request_items for all to authenticated
  using ((public.pr_owner(pr_id) = auth.uid() and public.pr_status_of(pr_id) in ('draft', 'rejected'))
         or public.can_manage_project(public.project_of_pr(pr_id)))
  with check ((public.pr_owner(pr_id) = auth.uid() and public.pr_status_of(pr_id) in ('draft', 'rejected'))
              or public.can_manage_project(public.project_of_pr(pr_id)));

-- ---------- approvals (เขียนผ่านฟังก์ชันเท่านั้น) ----------
create policy approvals_select on public.approvals for select to authenticated
  using (
    (document_type = 'purchase_request' and public.can_view_project(public.project_of_pr(document_id)))
    or (document_type = 'purchase_order' and public.can_view_project(public.project_of_po(document_id)))
    or (document_type = 'boq_version' and public.can_view_project(public.project_of_version(document_id)))
  );

-- ---------- purchase_orders ----------
create policy po_select on public.purchase_orders for select to authenticated
  using (public.can_view_project(project_id));
create policy po_write on public.purchase_orders for all to authenticated
  using (public.current_role_name() in ('purchasing', 'management'))
  with check (public.current_role_name() in ('purchasing', 'management'));
create policy po_items_select on public.purchase_order_items for select to authenticated
  using (public.can_view_project(public.project_of_po(po_id)));
create policy po_items_write on public.purchase_order_items for all to authenticated
  using (public.current_role_name() in ('purchasing', 'management'))
  with check (public.current_role_name() in ('purchasing', 'management'));

-- ---------- goods_receipts ----------
create policy gr_select on public.goods_receipts for select to authenticated
  using (public.can_view_project(public.project_of_po(po_id)));
create policy gr_insert on public.goods_receipts for insert to authenticated
  with check (received_by = auth.uid() and (
    (public.current_role_name() in ('site_supervisor', 'project_manager') and public.is_project_member(public.project_of_po(po_id)))
    or public.current_role_name() in ('purchasing', 'management')));
create policy gr_update on public.goods_receipts for update to authenticated
  using (public.current_role_name() = 'management' or received_by = auth.uid())
  with check (public.current_role_name() = 'management' or received_by = auth.uid());

create policy gr_items_select on public.goods_receipt_items for select to authenticated
  using (public.can_view_project(public.project_of_receipt(receipt_id)));
create policy gr_items_insert on public.goods_receipt_items for insert to authenticated
  with check (
    (public.current_role_name() in ('site_supervisor', 'project_manager') and public.is_project_member(public.project_of_receipt(receipt_id)))
    or public.current_role_name() in ('purchasing', 'management'));

-- ---------- subcontract (เฟส 2 แต่กำหนดสิทธิ์ไว้ก่อน) ----------
create policy sca_select on public.subcontract_agreements for select to authenticated
  using (public.can_view_project(project_id));
create policy sca_write on public.subcontract_agreements for all to authenticated
  using (public.can_manage_project(project_id) or public.current_role_name() in ('accounting', 'purchasing'))
  with check (public.can_manage_project(project_id) or public.current_role_name() in ('accounting', 'purchasing'));
create policy wcc_select on public.work_completion_certificates for select to authenticated
  using (public.can_view_project(public.project_of_agreement(agreement_id)));
create policy wcc_write on public.work_completion_certificates for all to authenticated
  using (public.current_role_name() in ('accounting', 'management') or public.can_manage_project(public.project_of_agreement(agreement_id)))
  with check (public.current_role_name() in ('accounting', 'management') or public.can_manage_project(public.project_of_agreement(agreement_id)));

-- ---------- invoices / payments ----------
create policy invoices_select on public.invoices for select to authenticated
  using (public.can_view_project(project_id));
create policy invoices_write on public.invoices for all to authenticated
  using (public.current_role_name() in ('accounting', 'management'))
  with check (public.current_role_name() in ('accounting', 'management'));
create policy payments_select on public.payments for select to authenticated
  using (public.can_view_project(public.project_of_invoice(invoice_id)));
create policy payments_write on public.payments for all to authenticated
  using (public.current_role_name() in ('accounting', 'management'))
  with check (public.current_role_name() in ('accounting', 'management'));

-- ---------- expenses ----------
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_view_project(project_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.is_project_member(project_id) or public.current_role_name() in ('management', 'accounting'));
create policy expenses_update on public.expenses for update to authenticated
  using (created_by = auth.uid() or public.can_manage_project(project_id) or public.current_role_name() = 'accounting')
  with check (created_by = auth.uid() or public.can_manage_project(project_id) or public.current_role_name() = 'accounting');
create policy expenses_delete on public.expenses for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_project(project_id));

-- ---------- settings ----------
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_write on public.settings for all to authenticated
  using (public.current_role_name() = 'management') with check (public.current_role_name() = 'management');

-- ---------- notifications (สร้างโดย service role เท่านั้น) ----------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- audit_logs ----------
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.current_role_name() in ('management', 'admin'));

-- ---------- storage: project-files ----------
-- path: projects/<project_id>/<...>
drop policy if exists "project files read" on storage.objects;
create policy "project files read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files'
         and public.can_view_project(((storage.foldername(name))[2])::uuid));
drop policy if exists "project files upload" on storage.objects;
create policy "project files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files'
              and public.can_view_project(((storage.foldername(name))[2])::uuid));
