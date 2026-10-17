-- ============================================================
-- เติมหรือแก้ตัวแปลงหน่วยของรายการสั่งซื้อที่บันทึกไปแล้ว (เช่น ตอนบันทึกยังไม่รู้ว่า 1 ชุดเท่ากับกี่ m2)
-- แก้ทั้งบรรทัดใบขอซื้อและบรรทัดใบสั่งซื้อที่ออกจากบรรทัดนั้น ปริมาณที่สั่งและรับในหน่วย BOQ จึงเปลี่ยนตามทันที
-- ยอดเงินไม่เปลี่ยน คำนวณธงเกิน BOQ และเกินราคาที่ทดไว้ของบรรทัดนั้นใหม่ไว้แสดง ไม่บังคับเหตุผลย้อนหลัง
-- ทุกการแก้ไขอยู่ใน audit log ผ่าน trigger เดิมของทั้งสองตาราง
-- ============================================================

create or replace function public.set_purchase_qty_factor(p_pr_item_id uuid, p_factor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_threshold numeric := public.setting_numeric('price_variance_threshold_pct', 5);
  v_ordered numeric;
  v_over_qty boolean;
  v_over_price boolean;
begin
  if p_factor is not null and not (p_factor > 0) then
    raise exception 'ตัวแปลงหน่วยต้องมากกว่า 0 หรือเว้นว่างไว้';
  end if;

  select pri.id, pri.boq_item_id, pri.qty, pri.unit_price, pr.project_id, pr.status,
         b.qty as boq_qty, b.unit_cost, b.is_off_boq
    into v_item
    from public.purchase_request_items pri
    join public.purchase_requests pr on pr.id = pri.pr_id
    join public.boq_items b on b.id = pri.boq_item_id
   where pri.id = p_pr_item_id
   for update of pri;
  if not found then raise exception 'ไม่พบรายการสั่งซื้อ'; end if;
  if not public.can_manage_project(v_item.project_id) then
    raise exception 'ไม่มีสิทธิ์แก้รายการสั่งซื้อนี้';
  end if;
  if v_item.status = 'cancelled' then raise exception 'รายการสั่งซื้อนี้ถูกยกเลิกแล้ว'; end if;

  -- ปริมาณที่สั่งแล้วของรายการ BOQ นี้ ไม่นับบรรทัดที่กำลังแก้ แล้วบวกบรรทัดนี้ด้วยตัวแปลงใหม่
  select coalesce(sum(poi.qty * poi.qty_factor), 0) into v_ordered
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.po_id
   where poi.boq_item_id = v_item.boq_item_id
     and po.status <> 'cancelled'
     and poi.pr_item_id is distinct from p_pr_item_id;

  v_over_qty := coalesce((not v_item.is_off_boq) and (v_ordered + v_item.qty * p_factor > v_item.boq_qty), false);
  v_over_price := coalesce((not v_item.is_off_boq) and v_item.boq_qty > 0
                           and v_item.unit_price / p_factor > v_item.unit_cost * (1 + v_threshold / 100), false);

  update public.purchase_request_items
     set qty_factor = p_factor, qty_over_boq = v_over_qty, price_over_threshold = v_over_price
   where id = p_pr_item_id;
  update public.purchase_order_items set qty_factor = p_factor where pr_item_id = p_pr_item_id;
end;
$$;

grant execute on function public.set_purchase_qty_factor(uuid, numeric) to authenticated;
