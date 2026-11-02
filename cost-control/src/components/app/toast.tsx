'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ข้อความเตือนลอยที่มุมขวาล่าง (มือถือ: เหนือแถบปุ่มบันทึกและเมนูล่าง) เห็นได้ทันทีไม่ว่าเลื่อนอยู่ตรงไหนของฟอร์ม
// ข้อผิดพลาดค้างไว้จนกดปิดหรือกดบันทึกใหม่ คำเตือนหายเองใน 10 วินาที ข้อความอื่น 5 วินาที

type Tone = 'danger' | 'warning' | 'success' | 'info'

interface ToastItem {
  id: number
  tone: Tone
  message: string
  action?: { label: string; onClick: () => void }
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id?: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TONE: Record<Tone, string> = {
  danger: 'border-danger-fg/40 bg-danger-bg text-danger-fg',
  warning: 'border-warning-fg/40 bg-warning-bg text-warning-fg',
  success: 'border-success-fg/40 bg-success-bg text-success-fg',
  info: 'border-border bg-card text-foreground',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id?: number) => {
    setItems(list => (id === undefined ? [] : list.filter(t => t.id !== id)))
  }, [])

  const show = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = nextId.current++
      // ข้อความเดียวกันซ้ำไม่ซ้อน แทนที่อันเดิม เก็บไว้ไม่เกิน 3 อัน
      setItems(list => [...list.filter(x => x.message !== t.message), { ...t, id }].slice(-3))
      if (t.tone !== 'danger') setTimeout(() => dismiss(id), t.tone === 'warning' ? 10000 : 5000)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div
        aria-live="assertive"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:w-96 no-print"
      >
        {items.map(t => (
          <div
            key={t.id}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className={cn('pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg', TONE[t.tone])}
          >
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 font-semibold underline"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="ปิด" className="shrink-0 px-1 font-semibold opacity-70" onClick={() => dismiss(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => {}, dismiss: () => {} }
}

// ฟอร์มยาวที่แสดง error ไว้หัวฟอร์ม เรียกตัวนี้เพื่อให้ error เด้งขึ้นมุมขวาล่างด้วย
export function useErrorToast(error: string | null) {
  const { show } = useToast()
  useEffect(() => {
    if (error) show({ tone: 'danger', message: error })
  }, [error, show])
}
