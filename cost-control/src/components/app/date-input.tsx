'use client'

import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatThaiDate, maskThaiDate, parseThaiDate } from '@/lib/date'

// ช่องวันที่แบบ วัน/เดือน/ปี พ.ศ. เสมอ ไม่ขึ้นกับภาษาของเบราว์เซอร์
// (ช่อง type="date" ของเบราว์เซอร์แสดงเดือนก่อนวันเมื่อเครื่องตั้งภาษาอังกฤษ และเว็บบังคับรูปแบบไม่ได้)
// พิมพ์ตัวเลขได้เลย ระบบใส่ / ให้ หรือกดปุ่มเลือกจากปฏิทิน ค่าที่ส่งไปกับฟอร์มเป็น YYYY-MM-DD
export function DateInput({
  name,
  value,
  defaultValue,
  onChange,
  required,
}: {
  name?: string
  value?: string // YYYY-MM-DD แบบควบคุมค่าเอง
  defaultValue?: string
  onChange?: (iso: string) => void
  required?: boolean
}) {
  const controlled = value !== undefined
  const [innerIso, setInnerIso] = useState(defaultValue ?? '')
  const iso = controlled ? value : innerIso
  // ข้อความที่กำลังพิมพ์ จำคู่กับค่าวันที่ที่ได้ ถ้าค่าเปลี่ยนจากที่อื่นให้แสดงตามค่าใหม่
  const [typed, setTyped] = useState<{ text: string; iso: string } | null>(null)
  const text = typed && typed.iso === iso ? typed.text : iso ? formatThaiDate(iso) : ''
  const pickerRef = useRef<HTMLInputElement>(null)

  function commit(nextIso: string) {
    if (!controlled) setInnerIso(nextIso)
    onChange?.(nextIso)
  }

  const invalid = text !== '' && iso === ''

  return (
    <div className="flex gap-2">
      <Input
        inputMode="numeric"
        placeholder="วว/ดด/ปปปป"
        value={text}
        required={required}
        aria-invalid={invalid}
        className={invalid ? 'border-destructive' : undefined}
        onChange={e => {
          const masked = maskThaiDate(e.target.value)
          const nextIso = parseThaiDate(masked)
          setTyped({ text: masked, iso: nextIso })
          commit(nextIso)
          e.target.setCustomValidity(masked !== '' && nextIso === '' ? 'วันที่ไม่ถูกต้อง ใช้รูปแบบ วว/ดด/ปปปป' : '')
        }}
      />
      <Button type="button" variant="outline" className="shrink-0" onClick={() => pickerRef.current?.showPicker?.()}>
        ปฏิทิน
      </Button>
      {/* ปฏิทินของเบราว์เซอร์ใช้เลือกวันอย่างเดียว ซ่อนไว้ */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        value={iso}
        onChange={e => {
          setTyped(null)
          commit(e.target.value)
        }}
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </div>
  )
}
