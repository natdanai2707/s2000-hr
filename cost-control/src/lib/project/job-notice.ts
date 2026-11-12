import type { UserRole } from '../types'

// อ่านข้อความแจ้งเปิด Job ที่ส่งกันในกลุ่ม LINE เช่น
//   แจ้ง เปิด Job/เพิ่มแผนก
//   - A6911-05(V107) งานพับขั้นบันได (รวินท์)
//   - ผู้รับผิดชอบ ณรงค์ฤทธิ์
//   - จัดซื้อ สุวรรณญา ค่ะ
//   @นาย 🐻🐻ณรงค์ฤทธิ์💰💰
// ได้รหัสงาน ชื่องาน ชื่อลูกค้าแบบย่อ และรายชื่อคนตามหน้าที่ ผู้ใช้ตรวจแก้ได้ก่อนเปิดงานทุกช่อง

export interface NoticePerson {
  role: UserRole
  label: string // คำในข้อความ เช่น ผู้รับผิดชอบ จัดซื้อ
  name: string // ชื่อตามที่พิมพ์ ตัดคำนำหน้าและคำลงท้ายแล้ว
}

export interface JobNotice {
  code: string | null
  version: string | null // เช่น V107 ต่อท้ายชื่องานตามแบบที่ใช้อยู่ "ชื่องาน (V107)"
  title: string | null // ชื่องานไม่รวมเลข V
  customer_hint: string | null // ชื่อลูกค้าแบบย่อในวงเล็บท้ายบรรทัด
  people: NoticePerson[]
}

const CODE_RE = /\b([A-Z]{1,4}\d{3,6}-\d{1,4})\b/i
// คำที่บอกหน้าที่ เรียงจากคำยาวไปสั้น ให้ "ผู้จัดการโครงการ" ไม่ถูกจับเป็น "จัดการ"
const ROLE_WORDS: { re: RegExp; role: UserRole; label: string }[] = [
  { re: /^(ผู้รับผิดชอบ(?:งาน|โครงการ)?|ผู้จัดการโครงการ|ผู้ควบคุมงาน|PM(?=[\s:]))/i, role: 'project_manager', label: 'ผู้รับผิดชอบ' },
  { re: /^(ฝ่ายจัดซื้อ|จัดซื้อ)/, role: 'purchasing', label: 'จัดซื้อ' },
  { re: /^(วิศวกร(?:โครงการ)?)/, role: 'engineer', label: 'วิศวกร' },
  { re: /^(หัวหน้า(?:หน้า)?งาน|โฟร์แมน|โฟแมน|foreman)/i, role: 'site_supervisor', label: 'หัวหน้างาน' },
  { re: /^(ฝ่ายบัญชี|บัญชี)/, role: 'accounting', label: 'บัญชี' },
]

const TITLE_RE = /^(นางสาว|น\.ส\.|นาย|นาง|คุณ|พี่|น้อง|ช่าง|K\.)\s*/i
const POLITE_RE = /\s*(ค่ะ|คะ|ครับ|คับ|จ้า|นะคะ|นะครับ|นะ)\s*$/

// ตัดอีโมจิและสัญลักษณ์ที่ไม่ใช่ตัวอักษร ตัวเลข หรือวรรณยุกต์ไทย
export function cleanName(s: string): string {
  let out = s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[:：=\-–—•·*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (let i = 0; i < 3; i++) out = out.replace(POLITE_RE, '').replace(TITLE_RE, '').trim()
  return out
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-–—•·*]|\d+[.)])\s*/, '').trim()
}

export function parseJobNotice(text: string): JobNotice {
  const notice: JobNotice = { code: null, version: null, title: null, customer_hint: null, people: [] }
  for (const raw of text.split(/\r?\n/)) {
    const line = stripBullet(raw)
    if (!line || line.startsWith('@')) continue

    const role = ROLE_WORDS.find(r => r.re.test(line))
    if (role) {
      const name = cleanName(line.replace(role.re, ''))
      if (name) notice.people.push({ role: role.role, label: role.label, name })
      continue
    }

    const m = !notice.code ? line.match(CODE_RE) : null
    if (m) {
      notice.code = m[1].toUpperCase()
      let rest = line.slice((m.index ?? 0) + m[0].length).trim()
      const v = rest.match(/^\(?\s*(V\s*\d+[A-Z]?)\s*\)?/i)
      if (v) {
        notice.version = v[1].replace(/\s+/g, '').toUpperCase()
        rest = rest.slice(v[0].length).trim()
      }
      // วงเล็บท้ายบรรทัดคือชื่อลูกค้าแบบย่อ
      const c = rest.match(/\(([^()]+)\)\s*$/)
      if (c) {
        notice.customer_hint = c[1].trim()
        rest = rest.slice(0, c.index).trim()
      }
      notice.title = rest.replace(/^[:\-–—]\s*/, '').trim() || null
    }
  }
  return notice
}

// ชื่อโครงการตามแบบที่ใช้อยู่: ชื่องาน (V107)
export function projectNameFromNotice(n: JobNotice): string {
  const title = n.title ?? ''
  return n.version ? `${title} (${n.version})`.trim() : title
}

const norm = (s: string) => cleanName(s).replace(/\s+/g, '').toLowerCase()

// หาผู้ใช้จากชื่อที่พิมพ์ ชื่อเล่นหรือชื่อจริงก็ได้ ต้องเจอคนเดียว ถ้าเจอหลายคนเลือกคนที่หน้าที่ตรงก่อน
export function matchProfile<T extends { id: string; full_name: string; role: string }>(name: string, role: UserRole, profiles: T[]): T | null {
  const key = norm(name)
  if (key.length < 2) return null
  const hits = profiles.filter(p => {
    const full = norm(p.full_name)
    if (!full) return false
    if (full.includes(key)) return true
    // พิมพ์ชื่อเต็มมา แต่ในระบบมีแค่ชื่อต้น
    const first = norm(p.full_name.split(/\s+/).find(w => cleanName(w).length >= 2) ?? '')
    return first.length >= 2 && key.startsWith(first)
  })
  if (hits.length <= 1) return hits[0] ?? null
  const sameRole = hits.filter(p => p.role === role)
  return sameRole.length === 1 ? sameRole[0] : null
}

// ชื่อลูกค้าเต็มจากไฟล์ BOQ: หาเซลล์ที่มีชื่อย่อในวงเล็บ แล้วเลือกเซลล์ที่ดูเป็นชื่อบริษัทที่สุด
export function customerFromCells(hint: string | null, cells: string[]): string | null {
  if (!hint) return null
  const h = hint.replace(/\s+/g, '')
  if (h.length < 2) return null
  const seen = new Map<string, number>()
  for (const c of cells) {
    const v = c.replace(/\s+/g, ' ').trim()
    if (v.length > 80 || !v.replace(/\s+/g, '').includes(h)) continue
    seen.set(v, (seen.get(v) ?? 0) + 1)
  }
  let best: string | null = null
  let bestScore = -Infinity
  for (const [v, count] of seen) {
    let score = count
    if (/จำกัด|บจก|หจก|มหาชน|co\.?,?\s*ltd|limited/i.test(v)) score += 10
    if (/จำกัด|limited|ltd/i.test(v)) score += 2 // ชื่อเต็มแบบที่ใช้ในเอกสารภาษี ดีกว่าตัวย่อ บจก.
    if (/งาน|โครงการ|ราคา|BOQ/i.test(v)) score -= 8
    score -= v.length / 100
    if (score > bestScore) {
      best = v
      bestScore = score
    }
  }
  return best
}
