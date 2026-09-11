import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-primary">S-2000 Project Cost Control</h1>
          <p className="text-sm text-muted-foreground mt-1">บริษัท เอส-2000 สตีล แฟบริเคท จำกัด</p>
        </div>
        <LoginForm next={next ?? '/'} initialError={error === 'inactive' ? 'บัญชีนี้ถูกปิดการใช้งาน' : null} />
      </div>
    </div>
  )
}
