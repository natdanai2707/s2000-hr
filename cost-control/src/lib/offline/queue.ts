'use client'

// offline queue สำหรับฟอร์มที่กำหนด (ใบขอซื้อ และ ความก้าวหน้าในเฟส 2)
// เก็บใน IndexedDB ผ่าน idb ส่งอัตโนมัติเมื่อกลับมาออนไลน์
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type QueueKind = 'purchase_request' | 'progress_update'

export interface QueuedItem {
  id: string // client_ref กันส่งซ้ำ
  kind: QueueKind
  payload: unknown
  created_at: string
  attempts: number
  last_error?: string
}

interface QueueDB extends DBSchema {
  queue: {
    key: string
    value: QueuedItem
    indexes: { 'by-kind': QueueKind }
  }
}

let dbPromise: Promise<IDBPDatabase<QueueDB>> | null = null

function db() {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB ไม่พร้อมใช้งาน')
  if (!dbPromise) {
    dbPromise = openDB<QueueDB>('s2000-cost-control', 1, {
      upgrade(database) {
        const store = database.createObjectStore('queue', { keyPath: 'id' })
        store.createIndex('by-kind', 'kind')
      },
    })
  }
  return dbPromise
}

export function newClientRef(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function enqueue(kind: QueueKind, payload: unknown, id = newClientRef()): Promise<QueuedItem> {
  const item: QueuedItem = { id, kind, payload, created_at: new Date().toISOString(), attempts: 0 }
  await (await db()).put('queue', item)
  notify()
  return item
}

export async function listQueue(kind?: QueueKind): Promise<QueuedItem[]> {
  const d = await db()
  return kind ? d.getAllFromIndex('queue', 'by-kind', kind) : d.getAll('queue')
}

export async function removeFromQueue(id: string) {
  await (await db()).delete('queue', id)
  notify()
}

export async function markAttempt(id: string, error: string) {
  const d = await db()
  const item = await d.get('queue', id)
  if (!item) return
  item.attempts += 1
  item.last_error = error
  await d.put('queue', item)
  notify()
}

type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeQueue(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function notify() {
  listeners.forEach(fn => fn())
}

// ส่งรายการที่ค้างทั้งหมดผ่าน sender ที่กำหนดต่อ kind
export type Sender = (item: QueuedItem) => Promise<{ ok: boolean; error?: string }>
let flushing = false
export async function flushQueue(senders: Partial<Record<QueueKind, Sender>>): Promise<number> {
  if (flushing) return 0
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0
  flushing = true
  let sent = 0
  try {
    const items = await listQueue()
    for (const item of items) {
      const sender = senders[item.kind]
      if (!sender) continue
      try {
        const res = await sender(item)
        if (res.ok) {
          await removeFromQueue(item.id)
          sent++
        } else {
          await markAttempt(item.id, res.error ?? 'ส่งไม่สำเร็จ')
        }
      } catch (e) {
        await markAttempt(item.id, e instanceof Error ? e.message : 'ส่งไม่สำเร็จ')
      }
    }
  } finally {
    flushing = false
  }
  return sent
}
