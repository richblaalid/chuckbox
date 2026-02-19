import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateFieldResolution, ConflictResolution } from '@/lib/sync/scoutbook'

/**
 * POST /api/scoutbook/sync/resolution
 *
 * Update a field resolution for a staged member
 * Allows users to override "Chuckbox wins" default for specific fields
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sessionId, memberId, field, resolution } = body as {
      sessionId: string
      memberId: string
      field: string
      resolution: ConflictResolution
    }

    if (!sessionId || !memberId || !field || !resolution) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, memberId, field, resolution' },
        { status: 400 }
      )
    }

    // Validate resolution value
    if (resolution !== 'chuckbox' && resolution !== 'scoutbook') {
      return NextResponse.json(
        { error: 'Invalid resolution value. Must be "chuckbox" or "scoutbook"' },
        { status: 400 }
      )
    }

    // Verify user has access to this session (via their unit membership)
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
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'No active unit membership' },
        { status: 403 }
      )
    }

    // Verify session belongs to user's unit
    const { data: session } = await supabase
      .from('sync_sessions')
      .select('unit_id')
      .eq('id', sessionId)
      .single()

    if (!session || session.unit_id !== membership.unit_id) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 403 }
      )
    }

    // Update the field resolution
    await updateFieldResolution(supabase, sessionId, memberId, field, resolution)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Resolution update error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
