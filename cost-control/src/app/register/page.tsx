import Link from 'next/link'
import { RegisterForm } from './register-form'

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary px-4 pb-16 pt-14 text-primary-foreground">
        <div className="mx-auto max-w-sm">
          <div className="font-display text-4xl font-bold leading-none">S-2000</div>
          <h1 className="font-display text-lg font-medium text-white/85 mt-1">สมัครใช้งาน Project Cost Control</h1>
        </div>
      </div>
      <div className="mx-auto -mt-10 w-full max-w-sm px-4 pb-10">
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          มีบัญชีแล้ว <Link href="/login" className="underline text-foreground">เข้าสู่ระบบ</Link>
        </p>
      </div>
    </div>
  )
}
