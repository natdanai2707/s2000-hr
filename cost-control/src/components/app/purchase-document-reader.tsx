'use client'

import { useEffect, useRef, useState } from 'react'
import { readPurchaseDocument, type PurchaseDocumentResult } from '@/actions/purchase-requests'
import { Alert } from '@/components/ui/alert'
import { formatBaht } from '@/lib/format'
import { formatThaiDate } from '@/lib/date'

// ย่อรูปในเบราว์เซอร์ก่อนส่ง รูปจากมือถือมักใหญ่เกินที่เซิร์ฟเวอร์รับ และยังแปลง HEIC ของ iPhone เป็น JPG ให้ด้วย
async function prepareFile(file: File): Promise<File> {
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

// projectId ว่าง = ยังไม่ได้เลือกโครงการ ระบบหาโครงการจากเลขงาน (JOB) ในเอกสารจาก candidateIds
export function PurchaseDocumentReader({ projectId, candidateIds, onRead }: { projectId: string; candidateIds: string[]; onRead: (r: PurchaseDocumentResult) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PurchaseDocumentResult | null>(null)

  async function readFile(picked: File) {
    setPending(true)
    setError(null)
    setResult(null)
    const fd = new FormData()
    fd.append('file', await prepareFile(picked))
    const res = await readPurchaseDocument(projectId || null, candidateIds, fd)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setResult(res.data)
    onRead(res.data)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (picked) void readFile(picked)
  }

  // กด Ctrl+V ที่ไหนก็ได้ในหน้า วางรูปที่ copy หรือ capture หน้าจอไว้ได้ทันที
  // ถ้ากำลังพิมพ์ในช่องกรอกและ clipboard มีข้อความ (เช่น copy จาก Excel ซึ่งมีทั้งข้อความและรูป) ให้วางข้อความตามปกติ
  const readRef = useRef(readFile)
  const pendingRef = useRef(pending)
  useEffect(() => {
    readRef.current = readFile
    pendingRef.current = pending
  })
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (pendingRef.current || !e.clipboardData) return
      const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      if (!file) return
      const t = e.target as HTMLElement | null
      const editing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (editing && e.clipboardData.types.includes('text/plain')) return
      e.preventDefault()
      void readRef.current(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">อ่านจากรูปใบสั่งซื้อ</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          ถ่ายรูปหรือแนบไฟล์ใบสั่งซื้อ ใบกำกับภาษี หรือใบเสร็จ Claude จะกรอกรายการและจับคู่กับ BOQ ให้ ไฟล์แนบเก็บไว้กับรายการนี้ ตรวจทุกบรรทัดก่อนกดบันทึก
          {!projectId && ' ยังไม่ต้องเลือกโครงการ ระบบเลือกให้จากเลข JOB ในเอกสาร'}
          <span className="hidden sm:inline"> หรือ copy รูปแล้วกด Ctrl+V ที่หน้านี้ได้เลย</span>
        </p>
      </div>
      {/* ปุ่มภาษาไทยแทนช่องเลือกไฟล์ของเบราว์เซอร์ บนมือถือกดแล้วเลือกถ่ายรูปหรือเลือกไฟล์ได้ */}
      <label className={`inline-flex h-11 w-full items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium ${pending ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
        {pending ? 'กำลังอ่านเอกสาร' : 'ถ่ายรูปหรือเลือกไฟล์'}
        <input type="file" accept="image/*,application/pdf" onChange={onFile} disabled={pending} className="sr-only" />
      </label>
      {pending && <p className="text-sm text-muted-foreground">กำลังอ่านเอกสาร ใช้เวลาประมาณ 30 วินาที</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <div className="space-y-2">
          {result.read_error ? (
            <Alert tone="warning">{result.read_error} แนบไฟล์ไว้แล้ว กรอกรายการเองได้</Alert>
          ) : (
            <div className="text-sm">
              อ่านได้ {result.lines.length} รายการ
              {result.supplier_name && ` จาก ${result.supplier_name}`}
              {result.document_no && ` เลขที่ ${result.document_no}`}
              {result.document_date && ` วันที่ ${formatThaiDate(result.document_date)}`}
              {result.total_excl_vat !== null && ` · รวม ${formatBaht(result.total_excl_vat)} บาท (ไม่รวม VAT)`}
              {result.lines.some(l => !l.boq_item_id) && (
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
          {(result.notes.length > 0 || result.warnings.length > 0) && (
            <Alert tone="info">{[...result.notes, ...result.warnings].join(' · ')}</Alert>
          )}
        </div>
      )}
    </div>
  )
}
