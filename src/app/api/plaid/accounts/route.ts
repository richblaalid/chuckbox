import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncPlaidAccounts, getUnitPlaidConnection } from '@/lib/plaid/client'

// GET - Fetch cached account data
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

    // Get user's profile
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

    // Only financial roles can view bank data
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can view bank accounts' },
        { status: 403 }
      )
    }

    // Get cached connection data
    const connection = await getUnitPlaidConnection(membership.unit_id)

    if (!connection) {
      return NextResponse.json({ connection: null })
    }

    return NextResponse.json({
      connection: {
        id: connection.id,
        institution_name: connection.institution_name,
        accounts: connection.accounts,
        status: connection.status,
        error_message: connection.error_message,
        last_synced_at: connection.last_synced_at,
      },
    })
  } catch (error) {
    console.error('Error fetching accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }
}

// POST - Refresh account data from Plaid
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

    // Only admins and treasurers can sync
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can sync bank accounts' },
        { status: 403 }
      )
    }

    // Sync accounts from Plaid
    const connection = await syncPlaidAccounts(membership.unit_id)

    if (!connection) {
      return NextResponse.json(
        { error: 'No bank connection found or sync failed' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        institution_name: connection.institution_name,
        accounts: connection.accounts,
        status: connection.status,
        last_synced_at: connection.last_synced_at,
      },
    })
  } catch (error) {
    console.error('Error syncing accounts:', error)
    return NextResponse.json(
      { error: 'Failed to sync accounts' },
      { status: 500 }
    )
  }
}
