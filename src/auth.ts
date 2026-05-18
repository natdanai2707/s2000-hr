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
    async signIn({ user, profile }) {
      const lineUserId = profile?.sub as string
      if (!lineUserId) return false
      return true
    },
    async session({ session, token }) {
      session.user.lineUserId = token.sub as string

      // ดึงข้อมูล employee
      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('line_user_id', token.sub)
        .single()

      if (employee) {
        session.user.employeeId = employee.id
        session.user.employeeCode = employee.employee_code
        session.user.employeeName = employee.name
        session.user.position = employee.position
        session.user.employeeType = employee.employee_type
      }

      // ดึงข้อมูล approver พร้อม is_admin
      const { data: approver } = await supabase
        .from('approvers')
        .select('id, is_admin')
        .eq('line_user_id', token.sub)
        .single()

      if (approver) {
        session.user.approverId = approver.id
        session.user.isAdmin = approver.is_admin || false
      }

      return session
    },
    async jwt({ token, profile }) {
      if (profile) {
        token.sub = profile.sub as string
      }
      return token
    },
  },
  pages: {
    signIn: '/login',
  },
})