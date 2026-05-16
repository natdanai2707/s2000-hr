import NextAuth from 'next-auth'
import LINE from 'next-auth/providers/line'
import { supabase } from '@/lib/supabase'

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

      // ตรวจสอบว่า line_user_id นี้มีในระบบหรือไม่
      const { data: employee } = await supabase
        .from('employees')
        .select('id, is_active')
        .eq('line_user_id', lineUserId)
        .single()

      // ถ้าไม่มีในระบบ ให้ล็อกอินได้แต่จะ redirect ไปหน้า pending
      // HR จะ assign line_user_id ให้ทีหลัง
      return true
    },
    async session({ session, token }) {
      session.user.lineUserId = token.sub as string

      // ดึงข้อมูล employee จาก line_user_id
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

      // ตรวจสอบว่าเป็น approver หรือไม่
      const { data: approver } = await supabase
        .from('approvers')
        .select('id')
        .eq('line_user_id', token.sub)
        .single()

      if (approver) {
        session.user.approverId = approver.id
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