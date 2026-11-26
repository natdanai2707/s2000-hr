-- เลขที่เอกสารจากผู้ขาย (PO ใบกำกับภาษี บิลเงินสด) ใช้กันบันทึกซ้ำ
-- document_key คือเลขที่ตัดช่องว่างและเครื่องหมายออก ตัวพิมพ์เล็ก ให้ PO-6611-0412 กับ PO 66110412 ถือเป็นใบเดียวกัน
alter table public.purchase_requests add column if not exists document_no text;
alter table public.purchase_requests add column if not exists document_key text;
create index if not exists purchase_requests_document_key_idx on public.purchase_requests (document_key) where document_key is not null;
comment on column public.purchase_requests.document_no is 'เลขที่เอกสารจากผู้ขายตามที่พิมพ์';
comment on column public.purchase_requests.document_key is 'เลขที่เอกสารแบบตัดเครื่องหมาย ใช้หาใบซ้ำ';
