'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadBoqPreview, importBoq, type UploadPreviewResult } from '@/actions/boq'
import { BOQ_COLUMN_LABELS, splitRows, type BoqColumnKey, type ColumnMapping } from '@/lib/boq/split'
import type { BoqVersionType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { FormField } from './common'


const COLUMN_KEYS: BoqColumnKey[] = ['item_no', 'description', 'unit', 'qty', 'material_price', 'labor_price', 'total', 'markup_pct']

export function BoqImportWizard({ projectId, hasConfirmed, initialType }: { projectId: string; hasConfirmed: boolean; initialType: BoqVersionType }) {
  const router = useRouter()
  const [type, setType] = useState<BoqVersionType>(initialType)
  const [markup, setMarkup] = useState('0')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<UploadPreviewResult | null>(null)
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({})
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = await uploadBoqPreview(projectId, fd)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPreview(res.data)
    const m: Record<string, ColumnMapping> = {}
    const inc: Record<string, boolean> = {}
    for (const s of res.data.sheets) {
      m[s.name] = s.mapping
      inc[s.name] = true
    }
    setMappings(m)
    setInclude(inc)
  }

  // สรุปล่วงหน้าจาก 20 แถวตัวอย่างและ mapping ปัจจุบัน (ตัวเลขจริงคำนวณหลังนำเข้า)
  const previewSummary = useMemo(() => {
    if (!preview) return null
    let items = 0
    let sections = 0
    for (const s of preview.sheets) {
      if (!include[s.name]) continue
      const r = splitRows(s.preview, mappings[s.name] ?? {}, Number(markup) || 0)
      items += r.items.length
      sections += r.sections.length
    }
    return { items, sections }
  }, [preview, mappings, include, markup])

  async function onImport() {
    if (!preview) return
    setPending(true)
    setError(null)
    const res = await importBoq(
      projectId,
      preview.file_path,
      type,
      preview.sheets.map(s => ({ name: s.name, mapping: mappings[s.name] ?? {}, include: include[s.name] ?? false })),
      Number(markup) || 0,
      note
    )
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/projects/${projectId}/boq/${res.data.version_id}`)
    router.refresh()
  }

  const allMapped = preview
    ? preview.sheets.every(s => !include[s.name] || (mappings[s.name]?.description !== undefined && mappings[s.name]?.description !== null && mappings[s.name]?.qty !== undefined && mappings[s.name]?.qty !== null))
    : false

  return (
    <div className="space-y-4 max-w-4xl">
      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={onUpload} className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="ประเภท">
            <Select value={type} onChange={e => setType(e.target.value as BoqVersionType)}>
              <option value="quotation">BOQ ใหม่ (ใบเสนอราคา)</option>
              {hasConfirmed && <option value="variation_order">VO (เปลี่ยนแปลงจาก BOQ ที่ยืนยัน)</option>}
            </Select>
          </FormField>
          <FormField label="markup เริ่มต้น (%)" hint="ใช้เมื่อไฟล์ไม่มีคอลัมน์ markup">
            <Input type="number" step="0.01" inputMode="decimal" value={markup} onChange={e => setMarkup(e.target.value)} />
          </FormField>
          <FormField label="หมายเหตุ">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น BOQ ฉบับลงนาม" />
          </FormField>
        </div>
        <FormField label="ไฟล์ BOQ (.xlsx)" hint="รองรับหลายชีต แถวหัวข้อหมวดที่ไม่มีปริมาณจะกลายเป็นหมวด แถวที่มีราคาวัสดุและแรงงานแยกกันจะแตกเป็น 2 รายการ">
          <Input type="file" name="file" accept=".xlsx" required />
        </FormField>
        {type === 'variation_order' && (
          <Alert tone="info">VO จะ copy รายการทั้งหมดจาก BOQ ที่ยืนยันแล้ว รายการในไฟล์ (ถ้ามี) จะถูกเพิ่มต่อท้าย จากนั้นแก้ไขเพิ่มลดเฉพาะรายการที่เปลี่ยนในหน้าถัดไป ไฟล์ไม่บังคับสำหรับ VO</Alert>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>{pending ? 'กำลังอ่านไฟล์' : 'อัปโหลดและดูตัวอย่าง'}</Button>
        </div>
      </form>

      {preview && (
        <div className="space-y-4">
          {preview.sheets.map(sheet => (
            <div key={sheet.name} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">ชีต {sheet.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {sheet.row_count} แถว · {sheet.mapping_from_template ? 'ใช้ template ที่บันทึกไว้' : 'ตรวจจับคอลัมน์อัตโนมัติ กรุณาตรวจสอบ'}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="w-4 h-4" checked={include[sheet.name] ?? false} onChange={e => setInclude(v => ({ ...v, [sheet.name]: e.target.checked }))} />
                  นำเข้าชีตนี้
                </label>
              </div>

              <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
                {COLUMN_KEYS.map(key => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs text-muted-foreground">{BOQ_COLUMN_LABELS[key]}{(key === 'description' || key === 'qty') ? ' *' : ''}</label>
                    <Select
                      className="h-9 text-sm"
                      value={mappings[sheet.name]?.[key] ?? ''}
                      onChange={e =>
                        setMappings(m => ({ ...m, [sheet.name]: { ...m[sheet.name], [key]: e.target.value === '' ? null : Number(e.target.value) } }))
                      }
                    >
                      <option value="">ไม่มี</option>
                      {sheet.headers.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {String.fromCharCode(65 + (idx % 26))}{idx >= 26 ? Math.floor(idx / 26) : ''}: {h || '(ว่าง)'}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="text-xs min-w-full">
                  <thead className="bg-muted">
                    <tr>
                      {sheet.headers.map((h, idx) => (
                        <th key={idx} className="px-2 py-1 text-left whitespace-nowrap font-medium">{h || `คอลัมน์ ${idx + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.preview.map((row, r) => (
                      <tr key={r} className="border-t border-border">
                        {sheet.headers.map((_, c) => (
                          <td key={c} className="px-2 py-1 whitespace-nowrap">{row[c] === null || row[c] === undefined ? '' : String(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">แสดงตัวอย่าง 20 แถวแรก</p>
            </div>
          ))}

          <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              จากตัวอย่าง: {previewSummary?.sections ?? 0} หมวด {previewSummary?.items ?? 0} รายการ (ตัวเลขเต็มแสดงหลังนำเข้า)
            </div>
            <Button onClick={onImport} disabled={pending || !allMapped}>{pending ? 'กำลังนำเข้า' : 'นำเข้า BOQ'}</Button>
          </div>
          {!allMapped && <Alert tone="warning">กรุณาจับคู่คอลัมน์ รายการ และ ปริมาณ ให้ครบทุกชีตที่เลือก</Alert>}
        </div>
      )}
      <SummaryHint />
    </div>
  )
}

function SummaryHint() {
  return (
    <p className="text-xs text-muted-foreground">
      หลังนำเข้า ระบบจะแสดงมูลค่าต้นทุนรวม ราคาขายรวม และกำไรคาดหวังแยกตามหมวดในหน้า BOQ เวอร์ชัน ปุ่มยืนยัน BOQ เห็นเฉพาะฝ่ายบริหาร
    </p>
  )
}
