import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getOAuthAuthorizeUrl, saveSquareCredentials } from '@/lib/square/client'
import { randomBytes } from 'crypto'

export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile (profile_id is separate from auth user id)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Get user's active membership
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only admins can connect Square
    if (membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only unit admins can connect Square' },
        { status: 403 }
      )
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const settingsUrl = `${baseUrl}/settings/integrations`

    // Check for test Square credentials (bypasses OAuth in development)
    const testAccessToken = process.env.SQUARE_TEST_ACCESS_TOKEN
    const testMerchantId = process.env.SQUARE_TEST_MERCHANT_ID
    const testRefreshToken = process.env.SQUARE_TEST_REFRESH_TOKEN

    if (testAccessToken && testMerchantId) {
      // Bypass OAuth and directly save test credentials
      // Set expiration to 30 days from now (test tokens don't expire but we need a value)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)

      await saveSquareCredentials(
        membership.unit_id,
        testMerchantId,
        testAccessToken,
        testRefreshToken || testAccessToken, // Use access token as refresh if not provided
        expiresAt.toISOString()
      )

      // Redirect back to settings with success message
      const successUrl = new URL(settingsUrl)
      successUrl.searchParams.set('success', 'Square connected successfully (test mode)')
      return NextResponse.redirect(successUrl)
    }

    // Generate a secure state token that includes the unit_id
    const stateToken = randomBytes(16).toString('hex')
    const state = `${stateToken}:${membership.unit_id}`

    // Store the state in a cookie for verification on callback
    const cookieStore = await cookies()
    cookieStore.set('square_oauth_state', stateToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })

    // Redirect to Square OAuth
    const authorizeUrl = getOAuthAuthorizeUrl(state)

    return NextResponse.redirect(authorizeUrl)
  } catch (error) {
    console.error('Square OAuth authorize error:', error)
    return NextResponse.json(
      { error: 'Failed to initiate Square authorization' },
      { status: 500 }
    )
  }
}
