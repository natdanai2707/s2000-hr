import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      lineUserId?: string
      employeeId?: string
      employeeCode?: string
      employeeName?: string
      position?: string
      employeeType?: string
      approverId?: string
    } & DefaultSession['user']
  }
}