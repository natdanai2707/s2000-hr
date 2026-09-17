// ชื่อไฟล์ใน Supabase Storage รองรับเฉพาะอักขระ ASCII ปลอดภัย
// ชื่อไฟล์ภาษาไทยทำให้อัปโหลดล้มด้วย Invalid key จึงสร้างชื่อใหม่ให้เสมอ
// ชื่อเดิมของไฟล์เก็บแยกในฐานข้อมูลเพื่อใช้แสดงผล

// นามสกุลไฟล์ที่ปลอดภัย ถ้าไม่มีหรือมีอักขระแปลกให้ใช้ค่าสำรอง
export function safeExtension(fileName: string, fallback: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return fallback
  const ext = fileName.slice(idx + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : fallback
}

// ชื่อไฟล์สำหรับเก็บใน Storage: เวลา + สุ่ม + ส่วนของชื่อเดิมที่เป็น ASCII (ถ้ามี)
export function safeObjectName(fileName: string, fallbackExt: string): string {
  const ext = safeExtension(fileName, fallbackExt)
  const dot = fileName.lastIndexOf('.')
  const rawBase = dot > 0 ? fileName.slice(0, dot) : fileName
  const base = rawBase
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return base ? `${stamp}-${base}.${ext}` : `${stamp}.${ext}`
}
