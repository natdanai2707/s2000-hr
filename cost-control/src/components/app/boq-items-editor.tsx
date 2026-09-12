'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveBoqItem, deleteBoqItem, type BoqItemInput } from '@/actions/boq'
import { BOQ_CATEGORY_LABELS, type BoqCategory } from '@/lib/types'
import { formatBaht, formatQty, toNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from './common'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export interface EditableItem {
  id: string
  section_id: string | null
  item_no: string | null
  description: string
  unit: string | null
  qty: number
  unit_cost: number
  category: BoqCategory
  markup_pct: number
  sell_unit_price: number
  is_off_boq: boolean
}

const CATEGORIES: BoqCategory[] = ['material', 'labor', 'subcontract', 'equipment', 'other']

export function BoqItemsEditor({
  projectId,
  versionId,
  canEdit,
  sections,
  items,
}: {
  projectId: string
  versionId: string
  canEdit: boolean
  sections: { id: string; name: string }[]
  items: EditableItem[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<EditableItem | null | 'new'>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const secName = (id: string | null) => sections.find(s => s.id === id)?.name ?? 'ไม่ระบุหมวด'

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const input: BoqItemInput = {
      section_id: String(fd.get('section_id') || '') || null,
      item_no: String(fd.get('item_no') ?? ''),
      description: String(fd.get('description') ?? ''),
      unit: String(fd.get('unit') ?? ''),
      qty: Number(fd.get('qty')),
      unit_cost: Number(fd.get('unit_cost')),
      category: String(fd.get('category') ?? 'material'),
      markup_pct: Number(fd.get('markup_pct')),
    }
    setPending(true)
    setError(null)
    const res = await saveBoqItem(versionId, projectId, editing === 'new' ? null : editing!.id, input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(null)
    router.refresh()
  }

  async function onDelete(id: string) {
    if (!confirm('ลบรายการนี้ใช่หรือไม่')) return
    setPending(true)
    const res = await deleteBoqItem(versionId, projectId, id)
    setPending(false)
    if (!res.ok) setError(res.error)
    else router.refresh()
  }

  const current = editing === 'new' ? null : editing

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setEditing('new')}>เพิ่มรายการ</Button>
        </div>
      )}

      <div className="hidden md:block rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ลำดับ</TableHead>
              <TableHead>รายการ</TableHead>
              <TableHead>หมวด</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead className="text-right">ปริมาณ</TableHead>
              <TableHead className="text-right">ทุน/หน่วย</TableHead>
              <TableHead className="text-right">markup</TableHead>
              <TableHead className="text-right">ขาย/หน่วย</TableHead>
              <TableHead className="text-right">รวมทุน</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id}>
                <TableCell>{it.item_no ?? ''}</TableCell>
                <TableCell>{it.description}{it.is_off_boq && <span className="ml-1 text-xs text-muted-foreground">(ระบบสร้าง)</span>}</TableCell>
                <TableCell className="whitespace-nowrap">{secName(it.section_id)}</TableCell>
                <TableCell className="whitespace-nowrap">{BOQ_CATEGORY_LABELS[it.category]}</TableCell>
                <TableCell className="text-right tabular whitespace-nowrap">{formatQty(it.qty)} {it.unit ?? ''}</TableCell>
                <TableCell className="text-right tabular">{formatBaht(it.unit_cost)}</TableCell>
                <TableCell className="text-right tabular">{toNumber(it.markup_pct).toFixed(2)}%</TableCell>
                <TableCell className="text-right tabular">{formatBaht(it.sell_unit_price)}</TableCell>
                <TableCell className="text-right tabular">{formatBaht(toNumber(it.qty) * toNumber(it.unit_cost))}</TableCell>
                {canEdit && (
                  <TableCell className="text-right whitespace-nowrap">
                    {!it.is_off_boq && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>แก้ไข</Button>
                        <Button size="sm" variant="ghost" onClick={() => onDelete(it.id)} disabled={pending}>ลบ</Button>
                      </>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-2">
        {items.map(it => (
          <div key={it.id} className="rounded-xl border border-border bg-card p-3">
            <div className="text-sm font-medium">{it.item_no ? `${it.item_no} ` : ''}{it.description}</div>
            <div className="text-xs text-muted-foreground">{secName(it.section_id)} · {BOQ_CATEGORY_LABELS[it.category]}</div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
              <div><div className="text-muted-foreground">ปริมาณ</div><div className="tabular">{formatQty(it.qty)} {it.unit ?? ''}</div></div>
              <div><div className="text-muted-foreground">ทุน/หน่วย</div><div className="tabular">{formatBaht(it.unit_cost)}</div></div>
              <div><div className="text-muted-foreground">รวมทุน</div><div className="tabular">{formatBaht(toNumber(it.qty) * toNumber(it.unit_cost))}</div></div>
            </div>
            {canEdit && !it.is_off_boq && (
              <div className="mt-2 flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditing(it)}>แก้ไข</Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(it.id)} disabled={pending}>ลบ</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'เพิ่มรายการ' : 'แก้ไขรายการ'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="หมวด">
                <Select name="section_id" defaultValue={current?.section_id ?? ''}>
                  <option value="">ไม่ระบุหมวด</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              <FormField label="ลำดับ">
                <Input name="item_no" defaultValue={current?.item_no ?? ''} />
              </FormField>
            </div>
            <FormField label="รายการ">
              <Input name="description" required defaultValue={current?.description ?? ''} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="ประเภท">
                <Select name="category" defaultValue={current?.category ?? 'material'}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{BOQ_CATEGORY_LABELS[c]}</option>)}
                </Select>
              </FormField>
              <FormField label="หน่วย">
                <Input name="unit" defaultValue={current?.unit ?? ''} />
              </FormField>
              <FormField label="ปริมาณ">
                <Input name="qty" type="number" step="0.001" inputMode="decimal" required defaultValue={current?.qty ?? ''} />
              </FormField>
              <FormField label="ต้นทุนต่อหน่วย">
                <Input name="unit_cost" type="number" step="0.01" inputMode="decimal" required defaultValue={current?.unit_cost ?? ''} />
              </FormField>
              <FormField label="markup (%)">
                <Input name="markup_pct" type="number" step="0.01" inputMode="decimal" defaultValue={current?.markup_pct ?? 0} />
              </FormField>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>ยกเลิก</Button>
              <Button type="submit" disabled={pending}>{pending ? 'กำลังบันทึก' : 'บันทึก'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
