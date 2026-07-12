import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import { exchangeCodeForTokens, saveSquareCredentials } from '@/lib/square/client'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const settingsUrl = `${baseUrl}/settings/integrations`

  // Handle OAuth errors from Square
  if (error) {
    logger.square.error('Square OAuth error', { error, errorDescription })
    const errorUrl = new URL(settingsUrl)
    errorUrl.searchParams.set('error', errorDescription || error)
    return NextResponse.redirect(errorUrl)
  }

  if (!code || !state) {
    const errorUrl = new URL(settingsUrl)
    errorUrl.searchParams.set('error', 'Missing authorization code or state')
    return NextResponse.redirect(errorUrl)
  }

  try {
    // Parse state: format is "stateToken:unitId"
    const [stateToken, unitId] = state.split(':')

    if (!stateToken || !unitId) {
      const errorUrl = new URL(settingsUrl)
      errorUrl.searchParams.set('error', 'Invalid state parameter')
      return NextResponse.redirect(errorUrl)
    }

    // Verify state token from cookie
    const cookieStore = await cookies()
    const storedState = cookieStore.get('square_oauth_state')?.value

    if (!storedState || storedState !== stateToken) {
      const errorUrl = new URL(settingsUrl)
      errorUrl.searchParams.set('error', 'Invalid state - please try again')
      return NextResponse.redirect(errorUrl)
    }

    // Clear the state cookie
    cookieStore.delete('square_oauth_state')

    // Verify the user still has admin access to this unit
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const errorUrl = new URL(settingsUrl)
      errorUrl.searchParams.set('error', 'Session expired - please log in again')
      return NextResponse.redirect(errorUrl)
    }

    // Authorize the user against the unit_id parsed from the state token.
    // The helper's fallback-to-first-membership behavior is unsafe here, so we
    // explicitly verify membership.unit_id === unitId after the lookup.
    const membership = await getCurrentMembership(supabase, unitId)
    if (!membership || membership.unit_id !== unitId || membership.role !== 'admin') {
      const errorUrl = new URL(settingsUrl)
      errorUrl.searchParams.set('error', 'You do not have permission to connect Square for this unit')
      return NextResponse.redirect(errorUrl)
    }

    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(code)

    // Save the encrypted credentials
    await saveSquareCredentials(
      unitId,
      tokens.merchantId!,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt!
    )

    // Redirect back to settings with success message
    const successUrl = new URL(settingsUrl)
    successUrl.searchParams.set('success', 'Square connected successfully')
    return NextResponse.redirect(successUrl)
  } catch (err) {
    logger.square.error('Square OAuth callback error', err)
    const errorUrl = new URL(settingsUrl)
    errorUrl.searchParams.set('error', 'Failed to connect Square account')
    return NextResponse.redirect(errorUrl)
  }
}
