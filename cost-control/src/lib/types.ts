export type UserRole =
  | 'engineer'
  | 'site_supervisor'
  | 'project_manager'
  | 'purchasing'
  | 'accounting'
  | 'management'
  | 'admin'

export const ROLE_LABELS: Record<UserRole, string> = {
  engineer: 'วิศวกร',
  site_supervisor: 'หัวหน้าหน้างาน',
  project_manager: 'ผู้จัดการโครงการ',
  purchasing: 'จัดซื้อ',
  accounting: 'บัญชี',
  management: 'ฝ่ายบริหาร',
  admin: 'ผู้ดูแลระบบ',
}

// สิทธิ์แต่ละแบบทำอะไรได้ แสดงตอนเลือก ให้ผู้เพิ่มผู้ใช้เลือกถูก
export const ROLE_HINTS: Record<UserRole, string> = {
  management: 'ใช้งานและแก้ไขได้ทุกฟีเจอร์ เห็นทุกโครงการ',
  admin: 'เหมือนฝ่ายบริหาร และจัดการบัญชีผู้ดูแลระบบได้',
  accounting: 'วางบิลและรับเงิน ใบแจ้งหนี้และการชำระเงิน เห็นทุกโครงการ',
  purchasing: 'ออกใบสั่งซื้อ เห็นทุกโครงการ',
  project_manager: 'จัดการโครงการที่เป็นสมาชิก อนุมัติใบขอซื้อ',
  engineer: 'ขอซื้อและบันทึกค่าใช้จ่ายในโครงการที่เป็นสมาชิก',
  site_supervisor: 'รับของและบันทึกหน้างานในโครงการที่เป็นสมาชิก',
}

export type ProjectStatus = 'draft' | 'active' | 'closing' | 'closed'
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'ร่าง',
  active: 'กำลังดำเนินการ',
  closing: 'กำลังปิด',
  closed: 'ปิดแล้ว',
}

export type BoqVersionType = 'quotation' | 'confirmed' | 'variation_order'
export type BoqVersionStatus = 'draft' | 'confirmed' | 'superseded'
export const BOQ_VERSION_TYPE_LABELS: Record<BoqVersionType, string> = {
  quotation: 'ใบเสนอราคา',
  confirmed: 'ยืนยัน',
  variation_order: 'VO',
}
export const BOQ_VERSION_STATUS_LABELS: Record<BoqVersionStatus, string> = {
  draft: 'ร่าง',
  confirmed: 'ยืนยันแล้ว',
  superseded: 'ถูกแทนที่',
}

export type BoqCategory = 'material' | 'labor' | 'subcontract' | 'equipment' | 'other'
export const BOQ_CATEGORY_LABELS: Record<BoqCategory, string> = {
  material: 'วัสดุ',
  labor: 'แรงงาน',
  subcontract: 'ผู้รับเหมาช่วง',
  equipment: 'เครื่องจักร',
  other: 'อื่นๆ',
}

export type PrStatus = 'draft' | 'pending_pm' | 'pending_management' | 'approved' | 'rejected' | 'cancelled'
export const PR_STATUS_LABELS: Record<PrStatus, string> = {
  draft: 'ร่าง',
  pending_pm: 'รอผู้จัดการโครงการ',
  pending_management: 'รอฝ่ายบริหาร',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

export type PoStatus = 'issued' | 'partially_received' | 'received' | 'cancelled'
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  issued: 'ออกแล้ว',
  partially_received: 'รับบางส่วน',
  received: 'รับครบ',
  cancelled: 'ยกเลิก',
}

export type InvoiceStatus = 'received' | 'approved' | 'paid'
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  received: 'รับแล้ว',
  approved: 'อนุมัติจ่าย',
  paid: 'จ่ายแล้ว',
}

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  branch_id: string | null
  line_user_id: string | null
  is_active: boolean
}

export interface Branch {
  id: string
  code: string
  name: string
}

export interface Project {
  id: string
  code: string
  name: string
  customer_name: string | null
  branch_id: string
  contract_value: number
  start_date: string | null
  planned_end_date: string | null
  actual_end_date: string | null
  status: ProjectStatus
  retention_pct: number
  penalty_per_day: number
}

export interface ProjectSummary {
  project_id: string
  code: string
  name: string
  customer_name: string | null
  branch_id: string
  status: ProjectStatus
  contract_value: number
  start_date: string | null
  planned_end_date: string | null
  actual_end_date: string | null
  confirmed_version_id: string | null
  total_budget: number
  expected_profit: number
  committed: number
  actual: number
  paid: number
  cost_pct: number | null
  progress_pct: number | null
  cost_vs_progress: number | null
  forecast_profit: number
  days_remaining: number | null
}

export interface BoqItemCost {
  boq_item_id: string
  boq_version_id: string
  project_id: string
  section_id: string | null
  item_no: string | null
  description: string
  unit: string | null
  category: BoqCategory
  is_off_boq: boolean
  qty: number
  unit_cost: number
  sell_unit_price: number
  budget: number
  sell_total: number
  committed: number
  actual: number
  paid: number
  qty_ordered: number
  qty_received: number
  qty_remaining: number
}

export interface Settings {
  price_variance_threshold_pct: number
  pm_approval_limit: number
  qty_over_boq_requires_management: boolean
  // ช่วงใช้งานคนเดียว: บันทึกการสั่งซื้อครั้งเดียวได้ทั้งอนุมัติ ใบสั่งซื้อ และรับของ
  direct_purchase_mode: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  price_variance_threshold_pct: 5,
  pm_approval_limit: 50000,
  qty_over_boq_requires_management: true,
  direct_purchase_mode: false,
}

// โหมดบันทึกซื้อตรงใช้ได้เฉพาะฝ่ายบริหารและผู้ดูแลระบบ บทบาทอื่นยังใช้ขั้นตอนขออนุมัติตามปกติ
export function usesDirectPurchase(settings: Settings, role: UserRole): boolean {
  return settings.direct_purchase_mode && (role === 'management' || role === 'admin')
}
