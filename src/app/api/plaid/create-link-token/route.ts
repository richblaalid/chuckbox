import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { createLinkToken } from '@/lib/plaid/client'

export async function POST(request: NextRequest) {
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
    if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can connect bank accounts' },
        { status: 403 }
      )
    }

    // Create Plaid link token
    const linkToken = await createLinkToken(membership.unit_id, membership.profile_id)

    return NextResponse.json({ link_token: linkToken })
  } catch (error) {
    console.error('Error creating link token:', error)

    // Extract more detailed error info
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = (error as { response?: { data?: unknown } })?.response?.data

    if (errorDetails) {
      console.error('Plaid API error details:', errorDetails)
    }

    return NextResponse.json(
      { error: `Failed to create link token: ${errorMessage}` },
      { status: 500 }
    )
  }
}
