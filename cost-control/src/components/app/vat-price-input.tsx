'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { pairFromExcl, pairFromIncl } from '@/lib/vat'
import { FormField } from './common'
import { cn } from '@/lib/utils'

// ราคาสองช่อง ไม่รวม VAT และรวม VAT กรอกช่องไหนอีกช่องคำนวณให้ ช่องที่กรอกล่าสุดเป็นตัวตั้ง
// ค่าที่ส่งออกไปให้ฟอร์มคือราคาไม่รวม VAT เสมอ
export function VatPriceInput({
  value,
  onChange,
  label = 'ราคาต่อหน่วย',
  required,
  invalid,
}: {
  value: string
  onChange: (excl: string) => void
  label?: string
  required?: boolean
  invalid?: boolean
}) {
  // ข้อความที่ผู้ใช้พิมพ์ในช่องรวม VAT จำไว้คู่กับราคาไม่รวม VAT ที่ได้จากข้อความนั้น
  // ถ้าราคาถูกเปลี่ยนจากที่อื่น (กรอกช่องไม่รวม VAT หรือระบบเติมราคาทดให้) ช่องรวม VAT คำนวณใหม่จากราคานั้น
  const [typedIncl, setTypedIncl] = useState<{ text: string; excl: string } | null>(null)
  const incl = typedIncl && typedIncl.excl === value ? typedIncl.text : pairFromExcl(value).incl

  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label={`${label} (ไม่รวม VAT)`}>
        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={e => {
            setTypedIncl(null)
            onChange(e.target.value)
          }}
          required={required}
          className={cn(invalid && 'border-destructive')}
        />
      </FormField>
      <FormField label={`${label} (รวม VAT)`}>
        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={incl}
          onChange={e => {
            const pair = pairFromIncl(e.target.value)
            setTypedIncl({ text: e.target.value, excl: pair.excl })
            onChange(pair.excl)
          }}
          className={cn(invalid && 'border-destructive')}
        />
      </FormField>
    </div>
  )
}
