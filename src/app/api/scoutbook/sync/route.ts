import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Database, Json } from '@/types/database'
import { syncFromScoutbook, stageRosterMembers } from '@/lib/sync/scoutbook'

// Create a service client for background updates (not tied to request)
function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Run sync in background and update database with results
 */
async function runSyncInBackground(
  sessionId: string,
  unitId: string,
  rosterOnly: boolean
) {
  const supabase = getServiceClient()

  try {
    const result = await syncFromScoutbook({
      rosterOnly,
      onProgress: async (progress) => {
        // Update session with progress
        await supabase
          .from('sync_sessions')
          .update({
            pages_visited: progress.current,
            records_extracted: progress.total,
          })
          .eq('id', sessionId)
      },
    })

    // Stage roster members for preview (instead of direct import)
    let stagingResult = null
    if (result.success && result.rosterMembers.length > 0) {
      try {
        stagingResult = await stageRosterMembers(supabase, sessionId, unitId, result.rosterMembers)
      } catch (stagingError) {
        console.error(`[Sync ${sessionId}] Staging error:`, stagingError)
        result.errors.push({
          timestamp: new Date(),
          pageUrl: '',
          pageType: 'staging',
          error: stagingError instanceof Error ? stagingError.message : String(stagingError),
        })
      }
    }

    // Update session with results - status is 'staged' pending user confirmation
    const newStatus = result.success && stagingResult ? 'staged' : (result.success ? 'completed' : 'failed')

    const { error: updateError } = await supabase
      .from('sync_sessions')
      .update({
        status: newStatus,
        completed_at: new Date().toISOString(),
        records_extracted: result.rosterMembers.length,
        pages_visited: result.session.pagesVisited,
        error_log: result.errors.length > 0 ? (result.errors as unknown as Json[]) : null,
      })
      .eq('id', sessionId)
      .select('id, status')
      .single()

    if (updateError) {
      console.error(`[Sync ${sessionId}] Failed to update session status:`, updateError)
    }
  } catch (error) {
    console.error(`[Sync ${sessionId}] Error:`, error)

    // Mark session as failed
    await supabase
      .from('sync_sessions')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_log: [
          {
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      })
      .eq('id', sessionId)
  }
}

/**
 * POST /api/scoutbook/sync
 *
 * Starts a Scoutbook sync session.
 *
 * Note: This feature requires `agent-browser` to be installed locally
 * and only works when running locally (not in serverless deployments).
 * The browser automation opens a headed browser for user login.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
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
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 403 }
      )
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

    // Only admins and treasurers can run sync
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only unit administrators can sync from Scoutbook' },
        { status: 403 }
      )
    }

    // Parse request options
    const body = await request.json().catch(() => ({}))
    const rosterOnly = body.rosterOnly ?? true

    // Check if we're in a local development environment
    const isLocal =
      process.env.NODE_ENV === 'development' ||
      process.env.ALLOW_LOCAL_SYNC === 'true'

    if (!isLocal) {
      return NextResponse.json(
        {
          error: 'Local environment required',
          message:
            'Scoutbook sync requires a headed browser and must be run locally. ' +
            'Please run the sync from the CLI or use a local development environment.',
          suggestion: 'Run: npx chuckbox sync scoutbook',
        },
        { status: 400 }
      )
    }

    // Create a sync session
    const { data: session, error: sessionError } = await supabase
      .from('sync_sessions')
      .insert({
        unit_id: membership.unit_id,
        status: 'running',
        created_by: profile.id,
      })
      .select()
      .single()

    if (sessionError) {
      console.error('Failed to create sync session:', sessionError)
      return NextResponse.json(
        { error: 'Failed to create sync session' },
        { status: 500 }
      )
    }

    // Start the sync in the background (fire and forget)
    // This runs async while we return the session ID immediately
    runSyncInBackground(session.id, membership.unit_id, rosterOnly)

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      message: 'Sync started. A browser window will open for login.',
    })
  } catch (error) {
    console.error('Scoutbook sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
