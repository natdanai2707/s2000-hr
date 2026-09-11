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

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {orderedSections.map(sec => (
          <div key={sec.id ?? 'none'}>
            <div className="text-xs font-medium text-muted-foreground px-1 mb-1">{sec.name}</div>
            <div className="space-y-2">
              {sortItems(bySection.get(sec.id) ?? []).map(it => {
                const p = usedPct(it)
                return (
                  <div key={it.boq_item_id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-tight">{it.item_no ? `${it.item_no} ` : ''}{it.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {BOQ_CATEGORY_LABELS[it.category]} · {formatQty(it.qty)} {it.unit ?? ''} · สั่งแล้ว {formatQty(it.qty_ordered)} รับแล้ว {formatQty(it.qty_received)}
                        </div>
                      </div>
                      <div className={cn('text-sm tabular shrink-0', pctTone(p))}>{p === null ? '-' : formatPct(p, 0)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
                      <div><div className="text-muted-foreground">งบ</div><div className="tabular">{formatBaht(it.budget)}</div></div>
                      <div><div className="text-muted-foreground">ผูกพัน</div><div className="tabular">{formatBaht(it.committed)}</div></div>
                      <div><div className="text-muted-foreground">จริง</div><div className="tabular">{formatBaht(it.actual)}</div></div>
                      <div><div className="text-muted-foreground">ชำระ</div><div className="tabular">{formatBaht(it.paid)}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
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
