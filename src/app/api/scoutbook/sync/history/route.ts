import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/scoutbook/sync/history
 *
 * Get recent sync history for the current user's unit
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Get user's unit membership
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No active unit membership' },
        { status: 403 }
      )
    }

    // Get last 10 sync sessions for this unit
    const { data: sessions, error } = await supabase
      .from('sync_sessions')
      .select('id, status, sync_source, records_extracted, completed_at, started_at')
      .eq('unit_id', membership.unit_id)
      .in('status', ['completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Error fetching sync history:', error)
      return NextResponse.json(
        { error: 'Failed to fetch sync history' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      history: (sessions || []).map((s) => ({
        id: s.id,
        status: s.status,
        syncSource: s.sync_source,
        recordsExtracted: s.records_extracted,
        completedAt: s.completed_at,
        startedAt: s.started_at,
      })),
    })
  } catch (error) {
    console.error('Sync history GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
