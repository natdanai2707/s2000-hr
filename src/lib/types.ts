export type EmployeeType = 'monthly' | 'daily'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ApprovalAction = 'approved' | 'rejected'

export interface Approver {
  id: string
  name: string
  email: string | null
  line_user_id: string | null
  is_active: boolean
}

export interface Employee {
  id: string
  employee_code: string
  name: string
  position: string
  employee_type: EmployeeType
  start_date: string
  daily_rate: number | null
  monthly_salary: number | null
  line_user_id: string | null
  sick_leave_quota: number
  personal_leave_quota: number
  vacation_leave_quota: number
  is_active: boolean
}

export interface ApprovalChain {
  id: string
  employee_id: string
  level: number
  approver_id: string
  approver?: Approver
}

export interface LeaveType {
  id: string
  name: string
  code: string
  is_paid: boolean
  deduct_quota: boolean
}

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  total_days: number
  late_minutes: number
  reason: string | null
  status: LeaveStatus
  current_approval_level: number
  created_at: string
  updated_at: string
  employee?: Employee
  leave_type?: LeaveType
  approval_actions?: ApprovalActionRecord[]
}

export interface ApprovalActionRecord {
  id: string
  leave_request_id: string
  approver_id: string
  level: number
  action: ApprovalAction
  comment: string | null
  acted_at: string
  approver?: Approver
}

export interface Project {
  id: string
  project_code: string
  project_name: string
  client: string | null
  start_date: string | null
  end_date: string | null
  is_active: boolean
}

export interface WorkLog {
  id: string
  employee_id: string
  log_date: string
  project_id: string | null
  job_code: string | null
  task_description: string
  hours_spent: number | null
  notes: string | null
  created_at: string
  employee?: Employee
  project?: Project
}