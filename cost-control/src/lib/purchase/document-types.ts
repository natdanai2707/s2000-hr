import type { ExtractedDoc } from './extract'
import type { ReviewedLine } from './review'

// ผลอ่านเอกสารจัดซื้อหนึ่งใบ ใช้ทั้งฝั่งเซิร์ฟเวอร์และฟอร์ม
export interface PurchaseDocumentResult {
  // โครงการที่ใช้อ่าน: ที่ผู้ใช้เลือก หรือที่หาได้จากเลขงานในเอกสาร null = ยังหาไม่ได้ ผู้ใช้ต้องเลือก
  project_id: string | null
  job_reference: string | null
  // null เมื่อยังไม่รู้โครงการ ไฟล์จะอัปโหลดตอนผู้ใช้เลือกโครงการ
  attachment_path: string | null
  // null เมื่ออ่านด้วย Claude ไม่ได้ ไฟล์ยังแนบไว้ได้ ผู้ใช้กรอกรายการเอง
  read_error: string | null
  supplier_name: string | null
  document_no: string | null
  document_date: string | null
  grand_total: number | null
  total_excl_vat: number | null
  lines: ReviewedLine[]
  issues: string[]
  notes: string[]
  warnings: string[]
  // เอกสารที่อ่านแล้วเมื่อยังไม่รู้โครงการ ส่งกลับมาพร้อมโครงการที่เลือก จะได้ไม่ต้องให้ Claude อ่านรูปซ้ำ
  unassigned_doc: ExtractedDoc | null
}
