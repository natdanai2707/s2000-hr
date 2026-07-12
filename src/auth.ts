import NextAuth from 'next-auth'
import LINE from 'next-auth/providers/line'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    LINE({
      clientId: process.env.LINE_CHANNEL_ID!,
      clientSecret: process.env.LINE_CHANNEL_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      return !!(profile?.sub)
    },
    async jwt({ token, profile, trigger }) {
      // query database เฉพาะตอน login ครั้งแรก หรือตอน update
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
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
})