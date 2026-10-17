'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { filterSuppliers, normalizeSupplierName, type SupplierOption } from '@/lib/suppliers'

export interface SupplierValue {
  id: string // ว่างเมื่อเป็นชื่อใหม่ที่ยังไม่มีในระบบ
  name: string
}

// ช่องพิมพ์ชื่อซัพพลายเออร์ที่กรองรายชื่อให้ระหว่างพิมพ์
// พิมพ์ชื่อที่ยังไม่มี ระบบจะบันทึกเป็นซัพพลายเออร์ใหม่ให้ตอนบันทึกเอกสาร
export function SupplierCombobox({
  suppliers,
  value,
  onChange,
  placeholder = 'พิมพ์ชื่อเพื่อค้นหา หรือพิมพ์ชื่อใหม่',
  disabled,
}: {
  suppliers: SupplierOption[]
  value: SupplierValue
  onChange: (v: SupplierValue) => void
  placeholder?: string
  disabled?: boolean
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const matches = filterSuppliers(suppliers, value.name)
  const exact = value.name.trim() !== '' && suppliers.some(s => normalizeSupplierName(s.name) === normalizeSupplierName(value.name))

  function type(text: string) {
    const hit = suppliers.find(s => normalizeSupplierName(s.name) === normalizeSupplierName(text))
    onChange({ id: hit?.id ?? '', name: text })
    setOpen(true)
  }

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={value.name}
        onChange={e => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && (matches.length > 0 || (value.name.trim() !== '' && !exact)) && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-md divide-y divide-border">
          {matches.map(s => (
            <li key={s.id} role="option" aria-selected={s.id === value.id}>
              <button
                type="button"
                className={cn('w-full text-left px-3 py-2 text-sm hover:bg-muted', s.id === value.id && 'font-medium')}
                // กันช่องพิมพ์เสียโฟกัสก่อนกดเลือก
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onChange({ id: s.id, name: s.name })
                  setOpen(false)
                }}
              >
                {s.name}
              </button>
            </li>
          ))}
          {value.name.trim() !== '' && !exact && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              ยังไม่มี &quot;{value.name.trim()}&quot; ในระบบ จะบันทึกเป็นซัพพลายเออร์ใหม่ให้อัตโนมัติ
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
