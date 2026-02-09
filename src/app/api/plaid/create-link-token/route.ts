import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createLinkToken } from '@/lib/plaid/client'

export async function POST() {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Get user's active membership and verify admin/treasurer role
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only admins and treasurers can connect bank accounts
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can connect bank accounts' },
        { status: 403 }
      )
    }

    // Create Plaid link token
    const linkToken = await createLinkToken(membership.unit_id, profile.id)

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
