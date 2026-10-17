-- ============================================================
-- ซัพพลายเออร์: ชื่อที่พิมพ์ในใบขอซื้อ ใบสั่งซื้อ หรือใบแจ้งหนี้ ถูกบันทึกเข้ารายชื่อซัพพลายเออร์อัตโนมัติ
-- ครั้งต่อไปจะขึ้นให้เลือกและกรองตามตัวอักษรที่พิมพ์
-- ชื่อเดียวกันที่ต่างกันแค่ตัวพิมพ์เล็กใหญ่หรือช่องว่าง ถือเป็นซัพพลายเออร์เดียวกัน ไม่สร้างซ้ำ
-- ============================================================

create or replace function public.normalize_supplier_name(p_name text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

create index if not exists suppliers_name_norm_idx on public.suppliers (public.normalize_supplier_name(name));

-- คืน id ของซัพพลายเออร์ตามชื่อ ถ้ายังไม่มีให้สร้าง
-- security definer เพราะวิศวกรและหัวหน้าหน้างานที่ขอซื้อไม่มีสิทธิ์เขียนตาราง suppliers โดยตรง
-- ฟังก์ชันนี้สร้างได้แค่ชื่อ แก้หรือลบไม่ได้ และการสร้างถูกบันทึกใน audit log
create or replace function public.ensure_supplier(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if v_name = '' then
    return null;
  end if;
  -- กันสองคนพิมพ์ชื่อใหม่เดียวกันพร้อมกันแล้วได้สองแถว
  perform pg_advisory_xact_lock(hashtext('supplier:' || public.normalize_supplier_name(v_name)));
  select id into v_id
    from public.suppliers
   where public.normalize_supplier_name(name) = public.normalize_supplier_name(v_name)
   order by created_at
   limit 1;
  if v_id is null then
    insert into public.suppliers (name, created_by) values (v_name, auth.uid()) returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.ensure_supplier(text) from public, anon;
grant execute on function public.ensure_supplier(text) to authenticated;

-- รายการขอซื้อที่พิมพ์ชื่อซัพพลายเออร์มา ผูกกับรายชื่อซัพพลายเออร์ให้อัตโนมัติ
-- ครอบทุกทางที่สร้างใบขอซื้อ รวมถึงคิวออฟไลน์
create or replace function public.pr_item_link_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supplier_id is null and btrim(coalesce(new.supplier_name, '')) <> '' then
    new.supplier_id := public.ensure_supplier(new.supplier_name);
  elsif new.supplier_id is not null and btrim(coalesce(new.supplier_name, '')) = '' then
    select name into new.supplier_name from public.suppliers where id = new.supplier_id;
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_request_items_link_supplier on public.purchase_request_items;
create trigger purchase_request_items_link_supplier
  before insert or update of supplier_id, supplier_name on public.purchase_request_items
  for each row execute function public.pr_item_link_supplier();

-- ย้อนเก็บชื่อที่เคยพิมพ์ไว้ในใบขอซื้อเดิมเข้ารายชื่อซัพพลายเออร์
update public.purchase_request_items
   set supplier_id = public.ensure_supplier(supplier_name)
 where supplier_id is null
   and btrim(coalesce(supplier_name, '')) <> '';
