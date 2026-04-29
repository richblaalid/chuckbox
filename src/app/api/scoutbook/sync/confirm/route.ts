import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { confirmStagedImport } from '@/lib/sync/scoutbook'

// Create a service client for import operations
function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/scoutbook/sync/confirm
 *
 * Confirm and import staged roster members.
 * Body: { sessionId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only unit administrators can confirm imports' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { sessionId, selectedScoutIds, selectedAdultIds } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    // Verify session exists and is in staged status
    const { data: session, error: sessionError } = await supabase
      .from('sync_sessions')
      .select('id, status, unit_id')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (session.unit_id !== membership.unit_id) {
      return NextResponse.json(
        { error: 'Session does not belong to your unit' },
        { status: 403 }
      )
    }

    if (session.status !== 'staged') {
      return NextResponse.json(
        { error: `Session is not staged (status: ${session.status})` },
        { status: 400 }
      )
    }

    // Use service client for import (bypasses RLS)
    const serviceClient = getServiceClient()

    // Update scout member selections if provided
    if (selectedScoutIds && Array.isArray(selectedScoutIds)) {
      // First, deselect all scout (YOUTH + P 18+) members for this session
      await serviceClient
        .from('sync_staged_members')
        .update({ is_selected: false })
        .eq('session_id', sessionId)
        .in('member_type', ['YOUTH', 'P 18+'])

      // Then, select only the specified scout members
      if (selectedScoutIds.length > 0) {
        await serviceClient
          .from('sync_staged_members')
          .update({ is_selected: true })
          .eq('session_id', sessionId)
          .in('id', selectedScoutIds)
      }
    }

    // Update adult member selections if provided
    if (selectedAdultIds && Array.isArray(selectedAdultIds)) {
      // First, deselect all adult (LEADER) members for this session
      await serviceClient
        .from('sync_staged_members')
        .update({ is_selected: false })
        .eq('session_id', sessionId)
        .eq('member_type', 'LEADER')

      // Then, select only the specified adult members
      if (selectedAdultIds.length > 0) {
        await serviceClient
          .from('sync_staged_members')
          .update({ is_selected: true })
          .eq('session_id', sessionId)
          .in('id', selectedAdultIds)
      }
    }

    // Perform the import
    const result = await confirmStagedImport(
      serviceClient,
      sessionId,
      membership.unit_id
    )

    // Update session status to completed
    await serviceClient
      .from('sync_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    return NextResponse.json({
      success: true,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
      adultsCreated: result.adultsCreated,
      adultsUpdated: result.adultsUpdated,
      adultsLinked: result.adultsLinked,
    })
  } catch (error) {
    console.error('Confirm import error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
