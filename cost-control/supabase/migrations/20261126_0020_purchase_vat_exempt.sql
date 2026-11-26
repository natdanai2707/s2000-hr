-- รายการสั่งซื้อจากผู้ขายที่ไม่ได้จด VAT (บุคคลธรรมดา บิลเงินสด) ราคาที่บันทึกคือราคาจ่ายจริง
-- ต้นทุนในระบบปกติไม่รวม VAT เพราะขอคืน VAT ได้ แต่ใบที่ไม่มี VAT ไม่มีอะไรให้ขอคืน ต้นทุนจึงเท่ากับยอดจ่ายเต็ม
alter table public.purchase_requests add column if not exists vat_exempt boolean not null default false;
comment on column public.purchase_requests.vat_exempt is 'true = ผู้ขายไม่เก็บ VAT ราคาในรายการคือราคาจ่ายจริง ยอดรวม VAT เท่ากับยอดไม่รวม VAT';
