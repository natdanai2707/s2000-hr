import Link from 'next/link'
import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary px-4 pb-16 pt-14 text-primary-foreground">
        <div className="mx-auto max-w-sm">
          <div className="font-display text-4xl font-bold leading-none">S-2000</div>
          <div className="font-display text-lg font-medium text-white/85 mt-1">Project Cost Control</div>
          <p className="text-sm text-white/70 mt-3">บริษัท เอส-2000 สตีล แฟบริเคท จำกัด</p>
        </div>
      </div>
      <div className="mx-auto -mt-10 w-full max-w-sm px-4 pb-10">
        <LoginForm
          next={next ?? '/'}
          initialError={error === 'inactive' ? 'บัญชีนี้ยังไม่เปิดใช้งาน ถ้าเพิ่งสมัคร รอฝ่ายบริหารเปิดบัญชีให้ก่อน' : null}
        />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          ยังไม่มีบัญชี <Link href="/register" className="underline text-foreground">สมัครใช้งาน</Link>
        </p>
      </div>
    </div>
  )
}
