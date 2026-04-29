import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { getStagedMembers } from '@/lib/sync/scoutbook'

/**
 * GET /api/scoutbook/sync/pending
 *
 * Check for any pending staged sync sessions for the current user's unit
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership) {
      return NextResponse.json({ error: 'No active unit membership' }, { status: 403 })
    }

    // Find any staged sessions for this unit
    const { data: stagedSession } = await supabase
      .from('sync_sessions')
      .select('id, records_extracted, created_at')
      .eq('unit_id', membership.unit_id)
      .eq('status', 'staged')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!stagedSession) {
      return NextResponse.json({ hasPending: false })
    }

    // Get staged members
    const members = await getStagedMembers(supabase, stagedSession.id)

    // Calculate summary
    const youthMembers = members.filter((m) => m.memberType === 'YOUTH')
    const adultMembers = members.filter((m) => m.memberType !== 'YOUTH')

    const summary = {
      toCreate: youthMembers.filter((m) => m.changeType === 'create').length,
      toUpdate: youthMembers.filter((m) => m.changeType === 'update').length,
      toSkip: youthMembers.filter((m) => m.changeType === 'skip').length,
      total: youthMembers.length,
      adultsToCreate: adultMembers.filter((m) => m.changeType === 'create').length,
      adultsToUpdate: adultMembers.filter((m) => m.changeType === 'update').length,
      adultsTotal: adultMembers.length,
    }

    return NextResponse.json({
      hasPending: true,
      sessionId: stagedSession.id,
      createdAt: stagedSession.created_at,
      members,
      summary,
    })
  } catch (error) {
    console.error('Pending sync check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
