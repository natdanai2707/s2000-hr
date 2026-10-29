import type { BoqItemCost } from '@/lib/types'
import { BOQ_CATEGORY_LABELS } from '@/lib/types'
import { formatBaht, formatPct, formatQty, toNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function usedPct(it: BoqItemCost): number | null {
  const b = toNumber(it.budget)
  if (b <= 0) return null
  return ((toNumber(it.actual) + toNumber(it.committed)) / b) * 100
}

function pctTone(p: number | null) {
  if (p === null) return ''
  if (p > 100) return 'text-danger-fg font-medium'
  if (p > 90) return 'text-warning-fg'
  return ''
}

export function BoqCostTable({ items, sections }: { items: BoqItemCost[]; sections: { id: string; name: string; sort_order: number }[] }) {
  const bySection = new Map<string | null, BoqItemCost[]>()
  for (const it of items) {
    const key = it.section_id
    if (!bySection.has(key)) bySection.set(key, [])
    bySection.get(key)!.push(it)
  }
  const orderedSections: { id: string | null; name: string }[] = [
    ...sections.map(s => ({ id: s.id as string | null, name: s.name })),
    ...(bySection.has(null) ? [{ id: null, name: 'ไม่ระบุหมวด' }] : []),
  ].filter(s => bySection.has(s.id))

  const sortItems = (arr: BoqItemCost[]) => [...arr].sort((a, b) => (a.item_no ?? '').localeCompare(b.item_no ?? '', 'th', { numeric: true }) || a.category.localeCompare(b.category))

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ลำดับ</TableHead>
              <TableHead>รายการ</TableHead>
              <TableHead>หมวด</TableHead>
              <TableHead className="text-right">ปริมาณ</TableHead>
              <TableHead className="text-right">งบ</TableHead>
              <TableHead className="text-right">ผูกพัน</TableHead>
              <TableHead className="text-right">จริง</TableHead>
              <TableHead className="text-right">ชำระ</TableHead>
              <TableHead className="text-right">ใช้ไป</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderedSections.map(sec => {
              const rows = sortItems(bySection.get(sec.id) ?? [])
              const tot = rows.reduce(
                (a, r) => ({ budget: a.budget + toNumber(r.budget), committed: a.committed + toNumber(r.committed), actual: a.actual + toNumber(r.actual), paid: a.paid + toNumber(r.paid) }),
                { budget: 0, committed: 0, actual: 0, paid: 0 }
              )
              const secPct = tot.budget > 0 ? ((tot.actual + tot.committed) / tot.budget) * 100 : null
              return (
                <RowsGroup key={sec.id ?? 'none'} name={sec.name} rows={rows} tot={tot} secPct={secPct} />
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: แต่ละหมวดพับไว้ เห็นยอดรวมหมวดก่อน แตะเพื่อดูรายการ รายการเป็นแถวสั้น ใช้ไป/งบ และ % */}
      <div className="md:hidden space-y-2">
        {orderedSections.map(sec => {
          const rows = sortItems(bySection.get(sec.id) ?? [])
          const tot = rows.reduce((a, r) => ({ budget: a.budget + toNumber(r.budget), used: a.used + toNumber(r.actual) + toNumber(r.committed) }), { budget: 0, used: 0 })
          const secPct = tot.budget > 0 ? (tot.used / tot.budget) * 100 : null
          return (
            <details key={sec.id ?? 'none'} className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">{sec.name}</div>
                  <div className="text-xs text-muted-foreground tabular">
                    {rows.length} รายการ · ใช้ {formatBaht(tot.used)} / งบ {formatBaht(tot.budget)}
                  </div>
                  <UsedBar pct={secPct} />
                </div>
                <div className={cn('text-sm tabular shrink-0', pctTone(secPct))}>{secPct === null ? '-' : formatPct(secPct, 0)}</div>
                <span className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
              </summary>
              <div className="divide-y divide-border border-t border-border">
                {rows.map(it => {
                  const p = usedPct(it)
                  const used = toNumber(it.actual) + toNumber(it.committed)
                  return (
                    <div key={it.boq_item_id} className="px-3 py-2.5">
                      <div className="flex justify-between gap-2">
                        <div className="min-w-0 text-sm leading-snug">
                          {it.item_no ? `${it.item_no} ` : ''}{it.description}
                          <span className="text-xs text-muted-foreground"> · {BOQ_CATEGORY_LABELS[it.category]}</span>
                        </div>
                        <div className={cn('text-sm tabular shrink-0', pctTone(p))}>{p === null ? '-' : formatPct(p, 0)}</div>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground tabular">
                        ใช้ {formatBaht(used)} / งบ {formatBaht(it.budget)} · {formatQty(it.qty_ordered)}/{formatQty(it.qty)} {it.unit ?? ''}
                        {toNumber(it.paid) > 0 && ` · ชำระ ${formatBaht(it.paid)}`}
                      </div>
                      {used > 0 && <UsedBar pct={p} />}
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </>
  )
}

function RowsGroup({ name, rows, tot, secPct }: { name: string; rows: BoqItemCost[]; tot: { budget: number; committed: number; actual: number; paid: number }; secPct: number | null }) {
  return (
    <>
      <TableRow className="bg-muted/60 hover:bg-muted/60">
        <TableCell colSpan={4} className="font-medium">{name}</TableCell>
        <TableCell className="text-right tabular font-medium">{formatBaht(tot.budget)}</TableCell>
        <TableCell className="text-right tabular font-medium">{formatBaht(tot.committed)}</TableCell>
        <TableCell className="text-right tabular font-medium">{formatBaht(tot.actual)}</TableCell>
        <TableCell className="text-right tabular font-medium">{formatBaht(tot.paid)}</TableCell>
        <TableCell className={cn('text-right tabular font-medium', pctTone(secPct))}>{secPct === null ? '-' : formatPct(secPct, 0)}</TableCell>
      </TableRow>
      {rows.map(it => {
        const p = usedPct(it)
        return (
          <TableRow key={it.boq_item_id}>
            <TableCell className="whitespace-nowrap">{it.item_no ?? ''}</TableCell>
            <TableCell>
              <div>{it.description}</div>
              <div className="text-xs text-muted-foreground">สั่งแล้ว {formatQty(it.qty_ordered)} · รับแล้ว {formatQty(it.qty_received)} · คงเหลือ {formatQty(it.qty_remaining)}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap">{BOQ_CATEGORY_LABELS[it.category]}</TableCell>
            <TableCell className="text-right tabular whitespace-nowrap">{formatQty(it.qty)} {it.unit ?? ''}</TableCell>
            <TableCell className="text-right tabular">{formatBaht(it.budget)}</TableCell>
            <TableCell className="text-right tabular">{formatBaht(it.committed)}</TableCell>
            <TableCell className="text-right tabular">{formatBaht(it.actual)}</TableCell>
            <TableCell className="text-right tabular">{formatBaht(it.paid)}</TableCell>
            <TableCell className={cn('text-right tabular', pctTone(p))}>{p === null ? '-' : formatPct(p, 0)}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

function UsedBar({ pct }: { pct: number | null }) {
  if (pct === null) return null
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full', pct > 100 ? 'bg-status-alert' : pct > 90 ? 'bg-status-watch' : 'bg-status-normal')}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}
