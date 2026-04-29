'use client'

import { useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/ui/logo'
import { trackLoginAttempted } from '@/lib/analytics'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  // Compute initial message from URL parameters
  const initialMessage = useMemo(() => {
    const error = searchParams.get('error')
    const urlMessage = searchParams.get('message')

    if (error === 'account_deactivated') {
      return {
        type: 'error' as const,
        text: 'Your account has been deactivated. Contact a unit administrator if you need to regain access.',
      }
    } else if (urlMessage === 'account_deleted') {
      return {
        type: 'success' as const,
        text: 'Your account has been deleted successfully.',
      }
    }
    return null
  }, [searchParams])

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(initialMessage)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const supabase = createClient()

    // Check for redirect parameter to pass through auth flow
    // Support both 'next' (new) and 'redirect' (legacy) for back-compat
    const redirectTo = searchParams.get('next') || searchParams.get('redirect')
    const callbackUrl = new URL('/auth/callback', window.location.origin)
    if (redirectTo) {
      callbackUrl.searchParams.set('next', redirectTo)
    }

    // Track login attempt (email domain only for privacy)
    const emailDomain = email.split('@')[1]
    trackLoginAttempted(emailDomain)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    })

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({
        type: 'success',
        text: 'Check your email for the login link!',
      })
    }

    setLoading(false)
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 border-t-4 border-t-amber-600 bg-white dark:bg-stone-800 px-10 py-10 shadow-xl shadow-stone-900/10">
      <p className="mb-6 text-center text-base text-slate-600 dark:text-stone-300">Sign in with your email to continue</p>

      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-base font-medium text-stone-700 dark:text-stone-200">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 block w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-3 text-base text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 shadow-sm placeholder:text-stone-400 focus:border-green-700 dark:focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-700/20 dark:focus:ring-green-600/30"
          />
        </div>

        {message && (
          <div
            className={`rounded-lg p-4 ${
              message.type === 'error'
                ? 'bg-error-light text-error-dark'
                : 'bg-success-light text-success-dark'
            }`}
          >
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center rounded-lg bg-green-800 dark:bg-green-700 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-all hover:bg-green-900 dark:hover:bg-green-800 hover:shadow-lg hover:shadow-green-900/25 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-green-700 focus:ring-offset-2 dark:focus:ring-offset-stone-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
        >
          {loading ? (
            <svg
              className="h-5 w-5 animate-spin text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <>
              <svg
                className="mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Send Magic Link
            </>
          )}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#FEFCF8] dark:bg-stone-900">
      {/* Top nav bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#FEFCF8]/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200/60 dark:border-stone-700/60">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Logo variant="full" size="lg" />
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-base font-medium text-slate-600 dark:text-stone-400 hover:text-slate-900 dark:hover:text-stone-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </nav>

      {/* Main content - centered */}
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10 pt-24">
        {/* Hero branding section */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
            Private Beta
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-stone-800 dark:text-stone-200">
            <span className="text-green-800 dark:text-green-500">Your unit,</span> <span className="text-amber-700 dark:text-amber-500">organized.</span>
          </h1>
          <p className="mt-3 max-w-lg text-lg text-slate-600 dark:text-stone-400">
            The all-in-one platform for Scout unit finances, billing, and operations.
          </p>
        </div>

        <div className="w-full max-w-lg">
          <Suspense fallback={
            <div className="rounded-xl border border-stone-200 dark:border-stone-700 border-t-4 border-t-amber-600 bg-white dark:bg-stone-800 px-10 py-10 shadow-xl shadow-stone-900/10">
              <div className="flex flex-col items-center text-center">
                <p className="text-base text-stone-500 dark:text-stone-400">Loading...</p>
              </div>
            </div>
          }>
            <LoginForm />
          </Suspense>
        </div>

        {/* Create unit link - only show if self-signup is enabled */}
        {process.env.NEXT_PUBLIC_ENABLE_SELF_SIGNUP === 'true' ? (
          <div className="mt-6 text-center">
            <p className="text-base text-slate-600 dark:text-stone-400">
              Setting up a new unit?{' '}
              <Link href="/signup" className="font-semibold text-green-800 hover:text-green-900 dark:text-green-500 dark:hover:text-green-400 transition-colors">
                Create your unit
              </Link>
            </p>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-base text-slate-600 dark:text-stone-400">
              Interested in ChuckBox for your unit?{' '}
              <Link href="/early-access" className="font-semibold text-green-800 hover:text-green-900 dark:text-green-500 dark:hover:text-green-400 transition-colors">
                Join the waitlist
              </Link>
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-10 flex items-center justify-center gap-5">
          <Link href="/privacy" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
            Terms
          </Link>
          <Link href="/contact" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
            Contact
          </Link>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            &copy; {new Date().getFullYear()} ChuckBox
          </span>
        </footer>
      </main>
    </div>
  )
}
