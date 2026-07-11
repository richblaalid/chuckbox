import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { getOAuthAuthorizeUrl, saveSquareCredentials } from '@/lib/square/client'
import { randomBytes } from 'crypto'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership || membership.role !== 'admin') {
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
    logger.square.error('Square OAuth authorize error', error)
    return NextResponse.json(
      { error: 'Failed to initiate Square authorization' },
      { status: 500 }
    )
  }
}
