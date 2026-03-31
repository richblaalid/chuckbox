import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Use getUser() to validate the session with Supabase servers
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/early-access' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/contact' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/pay/')

  // If user is not authenticated and trying to access a protected route
  if (!user && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // If user is authenticated and trying to access login page, redirect to dashboard
  if (user && pathname === '/login') {
    const dashboardUrl = new URL('/scouts', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  // If user is authenticated and trying to access signup, redirect to in-app unit creation
  if (user && pathname === '/signup') {
    const createUnitUrl = new URL('/create-unit', request.url)
    return NextResponse.redirect(createUnitUrl)
  }

  // Redirect /signup to /early-access if self-signup is not enabled
  if (pathname === '/signup' && process.env.NEXT_PUBLIC_ENABLE_SELF_SIGNUP !== 'true') {
    const earlyAccessUrl = new URL('/early-access', request.url)
    return NextResponse.redirect(earlyAccessUrl)
  }

  return supabaseResponse
}
