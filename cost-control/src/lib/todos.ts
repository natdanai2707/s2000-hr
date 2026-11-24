import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectSummary, UserRole } from './types'
import { closeoutWarnings, type CloseoutFigures } from './closeout'
import { costTone } from './cost'
import { formatBaht, toNumber } from './format'
import { todayISO } from './date'

// เรื่องที่ต้องจัดการ แสดงบนหน้าหลักก่อนตัวเลขต้นทุน ทุกข้อมาจากข้อมูลจริง ไม่มีข้อไหนเป็นศูนย์ก็ไม่แสดง
export interface Todo {
  key: string
  count: number
  title: string
  detail: string
  tone: 'warning' | 'danger'
  href: string
}

type Figures = CloseoutFigures & { project_id: string; code: string; status: string }

const FINANCE: UserRole[] = ['accounting', 'management', 'admin']

export async function loadTodos(
  supabase: SupabaseClient,
  opts: { role: UserRole; direct: boolean; projects: ProjectSummary[]; receivables: Figures[] }
): Promise<Todo[]> {
  const today = todayISO()
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const finance = FINANCE.includes(opts.role)

  const [approvals, bills, invoices] = await Promise.all([
    opts.direct ? Promise.resolve({ data: 0 }) : supabase.rpc('pending_approval_count'),
    finance
      ? supabase.from('v_customer_billing_status').select('outstanding, due_date').is('voided_at', null).gt('outstanding', 0).lt('due_date', today)
      : Promise.resolve({ data: [] as { outstanding: number }[] }),
    finance
      ? supabase.from('invoices').select('amount, due_date').neq('status', 'paid').lte('due_date', soon)
      : Promise.resolve({ data: [] as { amount: number }[] }),
  ])

  const todos: Todo[] = []
  const pending = Number(approvals.data ?? 0)
  if (pending > 0) todos.push({ key: 'approvals', count: pending, title: 'ใบขอซื้อรออนุมัติ', detail: 'กดเพื่ออนุมัติหรือส่งกลับ', tone: 'warning', href: '/approvals' })

  const active = opts.projects.filter(p => p.status === 'active')
  const over = active.filter(p => costTone(p) === 'alert')
  if (over.length) {
    todos.push({ key: 'over', count: over.length, title: 'โครงการต้นทุนเกินงบหรือขาดทุน', detail: over.slice(0, 2).map(p => p.code).join(' · '), tone: 'danger', href: '/#projects' })
  }
  const late = active.filter(p => !p.actual_end_date && p.days_remaining !== null && p.days_remaining < 0)
  if (late.length) {
    todos.push({ key: 'late', count: late.length, title: 'งานเลยกำหนดเสร็จ', detail: late.slice(0, 2).map(p => `${p.code} เกิน ${Math.abs(p.days_remaining!)} วัน`).join(' · '), tone: 'warning', href: '/#projects' })
  }

  const unfinished = opts.receivables.filter(r => r.status === 'closing' && closeoutWarnings(r).length > 0)
  if (unfinished.length) {
    const missing = unfinished.reduce((n, r) => n + Math.max(toNumber(r.contract_value) - toNumber(r.billed_excl_vat), 0), 0)
    todos.push({
      key: 'closeout',
      count: unfinished.length,
      title: 'งานเสร็จแล้ว ยังส่งงานหรือวางบิลไม่ครบ',
      detail: missing > 0.005 ? `ยังไม่ได้วางบิล ${formatBaht(missing)}` : unfinished.map(r => r.code).slice(0, 2).join(' · '),
      tone: 'danger',
      href: '/?show=finished',
    })
  }

  const overdue = (bills.data ?? []) as { outstanding: number }[]
  if (overdue.length) {
    const sum = overdue.reduce((n, b) => n + toNumber(b.outstanding), 0)
    todos.push({ key: 'bills', count: overdue.length, title: 'บิลลูกค้าเลยกำหนดชำระ', detail: `ค้างรับ ${formatBaht(sum)}`, tone: 'danger', href: '/billing' })
  }

  const due = (invoices.data ?? []) as { amount: number }[]
  if (due.length) {
    const sum = due.reduce((n, i) => n + toNumber(i.amount), 0)
    todos.push({ key: 'invoices', count: due.length, title: 'ใบแจ้งหนี้ผู้ขายครบกำหนดใน 7 วัน', detail: `รวม ${formatBaht(sum)}`, tone: 'warning', href: '/finance' })
  }
  return todos
}
