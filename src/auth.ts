import NextAuth from 'next-auth'
import LINE from 'next-auth/providers/line'
import Credentials from 'next-auth/providers/credentials'
import { createClient } from '@supabase/supabase-js'
import { scryptSync, timingSafeEqual } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ตรวจรหัสผ่านผู้จัดการจาก env (เก็บเป็น hash รูปแบบ salt:key ด้วย scrypt)
function verifyManagerPassword(password: string): boolean {
  const stored = process.env.MANAGER_PASSWORD_HASH
  if (!stored || !stored.includes(':')) return false
  try {
    const [salt, keyHex] = stored.split(':')
    const derived = scryptSync(password, salt, 64)
    const keyBuf = Buffer.from(keyHex, 'hex')
    if (derived.length !== keyBuf.length) return false
    return timingSafeEqual(derived, keyBuf)
  } catch {
    return false
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    LINE({
      clientId: process.env.LINE_CHANNEL_ID!,
      clientSecret: process.env.LINE_CHANNEL_SECRET!,
    }),
    // เข้าสู่ระบบด้วยอีเมล+รหัสผ่าน สำหรับผู้จัดการ/HR
    Credentials({
      name: 'manager',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string || '').trim().toLowerCase()
        const password = (credentials?.password as string) || ''
        const managerEmail = (process.env.MANAGER_EMAIL || '').trim().toLowerCase()
        if (!email || !password || !managerEmail) return null
        if (email !== managerEmail) return null
        if (!verifyManagerPassword(password)) return null
        return {
          id: `manager:${managerEmail}`,
          email: managerEmail,
          name: process.env.MANAGER_NAME || 'ผู้จัดการ',
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider === 'credentials') return true
      return !!(profile?.sub)
    },
    async jwt({ token, user, account, profile, trigger }) {
      // ผู้จัดการ (email/password) — ตั้งสิทธิ์ admin ให้เลย ไม่ query DB
      if (account?.provider === 'credentials' && user) {
        token.isManager = true
        token.isAdmin = true
        token.employeeName = (user.name as string) || 'ผู้จัดการ'
        token.managerEmail = user.email as string
        return token
      }

      // LINE: query database เฉพาะตอน login ครั้งแรก หรือตอน update
      if (profile?.sub || trigger === 'update') {
        const lineUserId = (profile?.sub as string) || (token.sub as string)
        token.sub = lineUserId

        const [empRes, apprRes] = await Promise.all([
          supabase.from('employees').select('*').eq('line_user_id', lineUserId).single(),
          supabase.from('approvers').select('id, is_admin').eq('line_user_id', lineUserId).single(),
        ])

        const employee = empRes.data
        const approver = apprRes.data

        if (employee) {
          token.employeeId = employee.id
          token.employeeCode = employee.employee_code
          token.employeeName = employee.name
          token.position = employee.position
          token.employeeType = employee.employee_type
        }

        if (approver) {
          token.approverId = approver.id
          token.isAdmin = approver.is_admin || false
        }

        // แจ้งเตือน admin ถ้าไม่มีในระบบ (ยิงครั้งเดียวตอน login)
        if (!employee && !approver) {
          try {
            await fetch(`${process.env.NEXTAUTH_URL}/api/notify/unregistered`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lineUserId,
                displayName: token.name,
              }),
            })
          } catch (e) {
            console.error('Notify failed:', e)
          }
        }
      }
      return token
    },
    async session({ session, token }) {
      // ไม่ query database เลย ใช้ค่าจาก token ที่ cache ไว้
      session.user.lineUserId = token.sub as string
      session.user.employeeId = token.employeeId as string | undefined
      session.user.employeeCode = token.employeeCode as string | undefined
      session.user.employeeName = token.employeeName as string | undefined
      session.user.position = token.position as string | undefined
      session.user.employeeType = token.employeeType as string | undefined
      session.user.approverId = token.approverId as string | undefined
      session.user.isAdmin = (token.isAdmin as boolean) || false
      session.user.isManager = (token.isManager as boolean) || false
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
})
