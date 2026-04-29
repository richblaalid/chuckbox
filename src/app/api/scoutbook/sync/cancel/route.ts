import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { cancelStaging } from '@/lib/sync/scoutbook'

// Create a service client for cancel operations
function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/scoutbook/sync/cancel
 *
 * Cancel a staged sync and discard all staged data.
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
        { error: 'Only unit administrators can cancel syncs' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { sessionId } = body

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

    // Use service client for cancel (bypasses RLS)
    const serviceClient = getServiceClient()

    // Cancel the staging
    await cancelStaging(serviceClient, sessionId)

    return NextResponse.json({
      success: true,
      message: 'Sync cancelled and staged data discarded',
    })
  } catch (error) {
    console.error('Cancel sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
