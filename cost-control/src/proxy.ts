import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// refresh session cookie ทุก request และบังคับ login สำหรับหน้าในแอป
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/offline')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }
  // บัญชียังไม่เปิดใช้งานถูกส่งกลับมาที่หน้า login พร้อม error=inactive ต้องแสดงหน้า login ไม่งั้นวนส่งกลับไปมา
  const inactiveBounce = request.nextUrl.searchParams.get('error') === 'inactive'
  if (user && !inactiveBounce && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|api/cron|.*\\.(?:png|svg|ico|json)$).*)'],
}
