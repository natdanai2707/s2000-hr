export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

export function fail(error: unknown, fallback = 'เกิดข้อผิดพลาด'): { ok: false; error: string } {
  if (typeof error === 'string') return { ok: false, error }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message: unknown }).message)
    // ข้อความจาก raise exception ใน Postgres เป็นภาษาไทยอยู่แล้ว
    return { ok: false, error: msg || fallback }
  }
  return { ok: false, error: fallback }
}
