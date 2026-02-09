import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnectPlaid } from '@/lib/plaid/client'

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

    // Get user's active membership and verify admin role
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only admins can disconnect bank accounts
    if (membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can disconnect bank accounts' },
        { status: 403 }
      )
    }

    // Disconnect Plaid
    await disconnectPlaid(membership.unit_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting Plaid:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect bank account' },
      { status: 500 }
    )
  }
}
