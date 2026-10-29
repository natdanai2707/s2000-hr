import Link from 'next/link'
import { RegisterForm } from './register-form'

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-primary">สมัครใช้งาน</h1>
          <p className="text-sm text-muted-foreground mt-1">S-2000 Project Cost Control</p>
        </div>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          มีบัญชีแล้ว <Link href="/login" className="underline text-foreground">เข้าสู่ระบบ</Link>
        </p>
      </div>
    </div>
  )
}
