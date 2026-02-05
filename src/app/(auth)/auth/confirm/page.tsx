'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { acceptPendingInvites } from '@/app/actions/users'
import { verifyProvisioningToken } from '@/app/actions/onboarding'
import { trackLoginCompleted } from '@/lib/analytics'

// Helper to safely check for pending invites (non-blocking)
async function tryAcceptInvites(): Promise<number> {
  try {
    const result = await acceptPendingInvites()
    return result.accepted
  } catch (err) {
    // Log but don't block auth flow if invite check fails
    console.error('Failed to check pending invites:', err)
    return 0
  }
}

// Helper to verify provisioning token if present
async function tryVerifyProvisioning(token: string | null): Promise<{
  verified: boolean
  unitName?: string
  importResult?: { adultsImported: number; scoutsImported: number; patrolsCreated: number }
}> {
  if (!token) return { verified: false }

  try {
    const result = await verifyProvisioningToken(token)
    if (result.success) {
      return {
        verified: true,
        unitName: result.unitName,
        importResult: result.importResult,
      }
    }
    console.error('Provisioning verification failed:', result.error)
    return { verified: false }
  } catch (err) {
    console.error('Failed to verify provisioning token:', err)
    return { verified: false }
  }
}

// Parse hash fragment parameters (for invite links with #access_token=...)
function parseHashParams(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const hash = window.location.hash.substring(1)
  const params: Record<string, string> = {}
  hash.split('&').forEach(pair => {
    const [key, value] = pair.split('=')
    if (key && value) {
      params[key] = decodeURIComponent(value)
    }
  })
  return params
}

function AuthConfirmContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Completing sign in...')
  const exchangeAttempted = useRef(false)

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (exchangeAttempted.current) return
    exchangeAttempted.current = true

    const supabase = createClient()

    // Listen for auth state changes (handles hash fragment automatically)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Track successful login
        trackLoginCompleted({ userId: session.user.id })

        // Check for provisioning token first
        const provisionToken = searchParams.get('provision_token')
        if (provisionToken) {
          setStatus('Activating your unit...')
          const provisionResult = await tryVerifyProvisioning(provisionToken)
          if (provisionResult.verified) {
            setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
            await new Promise(resolve => setTimeout(resolve, 1500))
            router.push('/setup')
            router.refresh()
            return
          }
        }

        setStatus('Completing sign in...')
        const accepted = await tryAcceptInvites()
        if (accepted > 0) {
          setStatus('Welcome! You have been added to your unit.')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        const next = searchParams.get('next') ?? '/dashboard'
        router.push(next)
        router.refresh()
      }
    })

    const handleAuth = async () => {
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') as 'email' | 'magiclink' | 'invite' | 'signup' | null
      const provisionToken = searchParams.get('provision_token')
      const next = searchParams.get('next') ?? '/dashboard'

      // Check for hash fragment params (from invite links)
      const hashParams = parseHashParams()
      const accessToken = hashParams.access_token
      const refreshToken = hashParams.refresh_token

      // First check if we already have a session
      const { data: { session: existingSession } } = await supabase.auth.getSession()
      if (existingSession) {
        // Check for provisioning token first
        if (provisionToken) {
          setStatus('Activating your unit...')
          const provisionResult = await tryVerifyProvisioning(provisionToken)
          if (provisionResult.verified) {
            setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
            await new Promise(resolve => setTimeout(resolve, 1500))
            router.push('/setup')
            router.refresh()
            return
          }
        }

        setStatus('Completing sign in...')
        const accepted = await tryAcceptInvites()
        if (accepted > 0) {
          setStatus('Welcome! You have been added to your unit.')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        router.push(next)
        router.refresh()
        return
      }

      // Handle hash fragment tokens (from invite links with #access_token=...)
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (sessionError) {
          console.error('Session set error:', sessionError.message)
          setError('Authentication failed. The link may have expired. Please request a new one.')
          return
        }

        // Session set successfully - check for provisioning token first
        if (provisionToken) {
          setStatus('Activating your unit...')
          const provisionResult = await tryVerifyProvisioning(provisionToken)
          if (provisionResult.verified) {
            setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
            await new Promise(resolve => setTimeout(resolve, 1500))
            router.push('/setup')
            router.refresh()
            return
          }
        }

        setStatus('Completing sign in...')
        const accepted = await tryAcceptInvites()
        if (accepted > 0) {
          setStatus('Welcome! You have been added to your unit.')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        router.push(next)
        router.refresh()
        return
      }

      // Handle token_hash (from email confirmation/invite links)
      if (tokenHash) {
        // Map type to valid OTP verification type
        const otpType = type === 'invite' ? 'invite' : type === 'signup' ? 'signup' : 'email'
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        })

        if (verifyError) {
          console.error('Token verification error:', verifyError.message)
          setError(verifyError.message)
          return
        }

        // Verification successful - check for provisioning token first
        if (provisionToken) {
          setStatus('Activating your unit...')
          const provisionResult = await tryVerifyProvisioning(provisionToken)
          if (provisionResult.verified) {
            setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
            await new Promise(resolve => setTimeout(resolve, 1500))
            router.push('/setup')
            router.refresh()
            return
          }
        }

        setStatus('Completing sign in...')
        const accepted = await tryAcceptInvites()
        if (accepted > 0) {
          setStatus('Welcome! You have been added to your unit.')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        router.push(next)
        router.refresh()
        return
      }

      // Handle code (from PKCE flow - user initiated login)
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) {
          // Check if we actually have a session despite the error
          const { data: { session: checkSession } } = await supabase.auth.getSession()
          if (checkSession) {
            if (provisionToken) {
              setStatus('Activating your unit...')
              const provisionResult = await tryVerifyProvisioning(provisionToken)
              if (provisionResult.verified) {
                setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
                await new Promise(resolve => setTimeout(resolve, 1500))
                router.push('/setup')
                router.refresh()
                return
              }
            }
            setStatus('Completing sign in...')
            const accepted = await tryAcceptInvites()
            if (accepted > 0) {
              setStatus('Welcome! You have been added to your unit.')
              await new Promise(resolve => setTimeout(resolve, 1500))
            }
            router.push(next)
            router.refresh()
            return
          }

          console.error('Code exchange error:', exchangeError.message)

          // If PKCE fails, try verifyOtp as fallback (for invite links)
          // Try 'invite' type first (from admin.inviteUserByEmail), then 'email' type
          const otpType = type === 'invite' ? 'invite' : type || 'invite'
          let { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: code,
            type: otpType,
          })

          // If invite type fails, try email type as fallback
          if (otpError && otpType === 'invite') {
            const fallbackResult = await supabase.auth.verifyOtp({
              token_hash: code,
              type: 'email',
            })
            otpError = fallbackResult.error
          }

          if (otpError) {
            console.error('OTP verification error:', otpError.message)
            setError('Authentication failed. The link may have expired. Please request a new one.')
            return
          }

          // OTP verification successful
          if (provisionToken) {
            setStatus('Activating your unit...')
            const provisionResult = await tryVerifyProvisioning(provisionToken)
            if (provisionResult.verified) {
              setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
              await new Promise(resolve => setTimeout(resolve, 1500))
              router.push('/setup')
              router.refresh()
              return
            }
          }
          setStatus('Completing sign in...')
          const accepted = await tryAcceptInvites()
          if (accepted > 0) {
            setStatus('Welcome! You have been added to your unit.')
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
          router.push(next)
          router.refresh()
          return
        }

        if (!data.session) {
          setError('Authentication failed. Please try again.')
          return
        }

        // Session is set - check for provisioning token first
        if (provisionToken) {
          setStatus('Activating your unit...')
          const provisionResult = await tryVerifyProvisioning(provisionToken)
          if (provisionResult.verified) {
            setStatus(`Welcome to ${provisionResult.unitName || 'your unit'}!`)
            await new Promise(resolve => setTimeout(resolve, 1500))
            router.push('/setup')
            router.refresh()
            return
          }
        }

        setStatus('Completing sign in...')
        const accepted = await tryAcceptInvites()
        if (accepted > 0) {
          setStatus('Welcome! You have been added to your unit.')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        router.push(next)
        router.refresh()
        return
      }

      // If we have hash params, wait a bit for onAuthStateChange to process them
      if (accessToken) {
        // Give the auth state listener time to process
        await new Promise(resolve => setTimeout(resolve, 2000))
        // If we're still here, auth state change didn't fire
        setError('Authentication failed. Please try again.')
        return
      }

      setError('No authentication code provided. Please request a new magic link.')
    }

    handleAuth()

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe()
    }
  }, [searchParams, router])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 dark:bg-stone-900 px-4">
        <div className="w-full max-w-md rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-8 shadow-sm">
          <h1 className="text-xl font-bold text-error">Authentication Failed</h1>
          <p className="mt-2 text-stone-600 dark:text-stone-300">{error}</p>
          <a
            href="/login"
            className="mt-4 block w-full rounded-md bg-primary px-4 py-2 text-center text-white hover:bg-primary/90"
          >
            Back to Login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 dark:bg-stone-900 px-4">
      <div className="w-full max-w-md rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-8 shadow-sm text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
        <p className="mt-4 text-stone-600 dark:text-stone-300">{status}</p>
      </div>
    </div>
  )
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 dark:bg-stone-900 px-4">
          <div className="w-full max-w-md rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-8 shadow-sm text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-stone-600 dark:text-stone-300">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthConfirmContent />
    </Suspense>
  )
}
