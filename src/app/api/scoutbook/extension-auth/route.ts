import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { getCurrentMembership, getCurrentProfile, getRequestedUnitId } from '@/lib/auth'
import {
  createExtensionToken,
  revokeExtensionToken,
  getActiveTokens,
  validateExtensionToken,
} from '@/lib/auth/extension-auth'

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/scoutbook/extension-auth
 *
 * Two modes:
 * 1. With session cookie: Get active extension tokens for the current user
 * 2. With Bearer token: Validate token and return unit info (for extension status check)
 */
export async function GET(request: NextRequest) {
  try {
    // Check for Bearer token first (extension calling to validate its token)
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const serviceClient = getServiceClient()
      const tokenData = await validateExtensionToken(serviceClient, token)

      if (!tokenData) {
        return NextResponse.json(
          { authenticated: false, error: 'Invalid or expired token' },
          { status: 401 }
        )
      }

      // Get unit name for display
      const { data: unit } = await serviceClient
        .from('units')
        .select('id, name, unit_number, unit_type')
        .eq('id', tokenData.unitId)
        .single()

      const unitName = unit
        ? `${unit.unit_type.charAt(0).toUpperCase() + unit.unit_type.slice(1)} ${unit.unit_number}`
        : 'Unknown Unit'

      return NextResponse.json({
        authenticated: true,
        unitId: tokenData.unitId,
        unitName,
        unitFullName: unit?.name || unitName,
      })
    }

    // Session-based auth (Chuckbox UI calling to list tokens)
    const supabase = await createClient()
    const profile = await getCurrentProfile(supabase)
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tokens = await getActiveTokens(supabase, profile.id)

    return NextResponse.json({ tokens })
  } catch (error) {
    console.error('Extension auth GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/scoutbook/extension-auth
 *
 * Generate a new extension auth token
 * Only admins and treasurers can generate tokens
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only unit administrators can generate extension tokens' },
        { status: 403 }
      )
    }

    const { token, expiresAt } = await createExtensionToken(
      supabase,
      membership.profile_id,
      membership.unit_id
    )

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      message:
        'Token generated successfully. Copy it now - it will not be shown again.',
    })
  } catch (error) {
    console.error('Extension auth POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/scoutbook/extension-auth
 *
 * Revoke an extension token
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const profile = await getCurrentProfile(supabase)
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const tokenId = searchParams.get('tokenId')

    if (!tokenId) {
      return NextResponse.json(
        { error: 'Token ID required' },
        { status: 400 }
      )
    }

    await revokeExtensionToken(supabase, tokenId, profile.id)

    return NextResponse.json({ success: true, message: 'Token revoked' })
  } catch (error) {
    console.error('Extension auth DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
