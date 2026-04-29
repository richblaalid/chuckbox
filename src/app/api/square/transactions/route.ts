import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'

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

    // Only admins and treasurers can view Square transactions
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can view Square transactions' },
        { status: 403 }
      )
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '30')
    const status = searchParams.get('status') || 'all'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

    // Calculate date range
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Build query
    let query = supabase
      .from('square_transactions')
      .select('*')
      .eq('unit_id', membership.unit_id)
      .gte('square_created_at', startDate.toISOString())
      .order('square_created_at', { ascending: false })
      .limit(limit)

    // Apply status filter
    if (status !== 'all') {
      query = query.eq('status', status.toUpperCase())
    }

    const { data: transactions, error } = await query

    if (error) {
      console.error('Error fetching Square transactions:', error)
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
    }

    // Get last sync time
    const { data: credentials } = await supabase
      .from('unit_square_credentials')
      .select('last_sync_at')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .single()

    return NextResponse.json({
      transactions: transactions || [],
      lastSyncAt: credentials?.last_sync_at || null,
    })
  } catch (error) {
    console.error('Square transactions error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    )
  }
}
