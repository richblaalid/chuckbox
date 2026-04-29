import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { syncSquareTransactions, getUnreconciledTransactions } from '@/lib/square/sync'

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

    // Only admins and treasurers can sync
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can sync Square transactions' },
        { status: 403 }
      )
    }

    // Parse optional date range from request body
    let startDate: Date | undefined
    let endDate: Date | undefined

    try {
      const body = await request.json()
      if (body.startDate) {
        startDate = new Date(body.startDate)
      }
      if (body.endDate) {
        endDate = new Date(body.endDate)
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Perform sync
    const result = await syncSquareTransactions(membership.unit_id, {
      startDate,
      endDate,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Square sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync transactions' },
      { status: 500 }
    )
  }
}

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
    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only financial roles can view unreconciled transactions
    if (!['admin', 'treasurer', 'leader'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    const transactions = await getUnreconciledTransactions(membership.unit_id)

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('Error fetching unreconciled transactions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    )
  }
}
