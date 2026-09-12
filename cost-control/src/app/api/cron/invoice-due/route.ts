import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { formatBaht } from '@/lib/format'
import { formatThaiDate } from '@/lib/date'

// แจ้ง accounting เมื่อ invoice ครบกำหนดใน 3 วัน (Vercel cron รายวัน)
export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const today = new Date()
  const limit = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10)
  const [{ data: invoices }, { data: accountants }] = await Promise.all([
    admin.from('invoices').select('id, invoice_no, amount, due_date, suppliers(name)').neq('status', 'paid').not('due_date', 'is', null).lte('due_date', limit),
    admin.from('profiles').select('id').in('role', ['accounting', 'management']).eq('is_active', true),
  ])
  const userIds = (accountants ?? []).map(a => a.id)
  let sent = 0
  for (const inv of invoices ?? []) {
    // กันแจ้งซ้ำวันเดียวกัน
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'invoice_due')
      .eq('link', `/finance?invoice=${inv.id}`)
      .gte('created_at', new Date(today.toISOString().slice(0, 10)).toISOString())
    if ((count ?? 0) > 0) continue
    await notify({
      event: 'invoice_due',
      userIds,
      title: `ใบแจ้งหนี้ ${inv.invoice_no} ครบกำหนด ${formatThaiDate(inv.due_date)}`,
      body: `${(inv.suppliers as unknown as { name: string } | null)?.name ?? ''} จำนวน ${formatBaht(inv.amount)} บาท`,
      link: `/finance?invoice=${inv.id}`,
    })
    sent++
  }
  return NextResponse.json({ ok: true, sent })
}
