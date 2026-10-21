'use client'

import { useEffect, useRef } from 'react'
import type { PurchaseDocumentResult } from '@/lib/purchase/document-types'
import { Alert } from '@/components/ui/alert'
import { formatBaht } from '@/lib/format'
import { formatThaiDate } from '@/lib/date'

// ย่อรูปในเบราว์เซอร์ก่อนส่ง รูปจากมือถือมักใหญ่เกินที่เซิร์ฟเวอร์รับ และยังแปลง HEIC ของ iPhone เป็น JPG ให้ด้วย
export async function prepareFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'document'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

const accepted = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf'

// รับรูปหรือ PDF ได้หลายไฟล์ในครั้งเดียว ทั้งจากปุ่มเลือกไฟล์และ Ctrl+V แต่ละไฟล์คือเอกสารหนึ่งใบ คนละงานกันได้
export function PurchaseDocumentPicker({ onFiles, count }: { onFiles: (files: File[]) => void; count: number }) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].filter(accepted)
    e.target.value = ''
    if (files.length) onFiles(files)
  }

  // กด Ctrl+V ที่ไหนก็ได้ในหน้า วางรูปที่ copy หรือ capture หน้าจอไว้ได้ทันที วางทีละรูปหลายครั้งได้
  // ถ้ากำลังพิมพ์ในช่องกรอกและ clipboard มีข้อความ (เช่น copy จาก Excel ซึ่งมีทั้งข้อความและรูป) ให้วางข้อความตามปกติ
  const onFilesRef = useRef(onFiles)
  useEffect(() => {
    onFilesRef.current = onFiles
  })
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const files = [...e.clipboardData.files].filter(accepted)
      if (!files.length) return
      const t = e.target as HTMLElement | null
      const editing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (editing && e.clipboardData.types.includes('text/plain')) return
      e.preventDefault()
      onFilesRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">อ่านจากรูปใบสั่งซื้อ</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          เลือกได้หลายไฟล์ในครั้งเดียว คนละงานก็ได้ ระบบเลือกโครงการให้จากเลข JOB ในเอกสาร แต่ละใบกลายเป็นหนึ่งรายการสั่งซื้อ ตรวจทุกบรรทัดก่อนกดบันทึก
          <span className="hidden sm:inline"> หรือ copy รูปแล้วกด Ctrl+V ที่หน้านี้ วางทีละรูปหลายครั้งได้</span>
        </p>
      </div>
      {/* ปุ่มภาษาไทยแทนช่องเลือกไฟล์ของเบราว์เซอร์ บนมือถือกดแล้วเลือกถ่ายรูปหรือเลือกไฟล์ได้ */}
      <label className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium hover:bg-muted">
        {count ? 'เพิ่มเอกสาร' : 'ถ่ายรูปหรือเลือกไฟล์'}
        <input type="file" accept="image/*,application/pdf" multiple onChange={onChange} className="sr-only" />
      </label>
    </div>
  )
}

// สรุปผลอ่านเอกสารหนึ่งใบ: ผู้ขาย เลขที่ ยอดรวม จุดที่ตัวเลขไม่ตรง และสิ่งที่ระบบปรับให้
export function PurchaseDocumentSummary({ result }: { result: PurchaseDocumentResult }) {
  return (
    <div className="space-y-2">
      {result.read_error ? (
        <Alert tone="warning">{result.read_error} แนบไฟล์ไว้แล้ว กรอกรายการเองได้</Alert>
      ) : (
        <div className="text-sm">
          อ่านได้ {result.lines.length || result.unassigned_doc?.lines.length || 0} รายการ
          {result.supplier_name && ` จาก ${result.supplier_name}`}
          {result.document_no && ` เลขที่ ${result.document_no}`}
          {result.document_date && ` วันที่ ${formatThaiDate(result.document_date)}`}
          {result.job_reference && ` · JOB ${result.job_reference}`}
          {result.total_excl_vat !== null && ` · รวม ${formatBaht(result.total_excl_vat)} บาท (ไม่รวม VAT)`}
          {result.project_id && result.lines.some(l => !l.boq_item_id) && (
            <div className="text-warning-fg">ยังไม่ได้จับคู่กับ BOQ {result.lines.filter(l => !l.boq_item_id).length} บรรทัด เลือกรายการ BOQ ให้ก่อนบันทึก</div>
          )}
        </div>
      )}
      {result.issues.length > 0 && (
        <Alert tone="danger">
          <div className="font-medium">ตัวเลขในเอกสารไม่ตรงกัน {result.issues.length} จุด อาจอ่านผิด ตรวจกับเอกสารจริง</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {result.issues.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </Alert>
      )}
      {(result.notes.length > 0 || result.warnings.length > 0) && <Alert tone="info">{[...result.notes, ...result.warnings].join(' · ')}</Alert>}
    </div>
  )
}
