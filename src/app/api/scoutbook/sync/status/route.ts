import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStagedMembers } from '@/lib/sync/scoutbook'

/**
 * GET /api/scoutbook/sync/status?sessionId=xxx
 *
 * Get the status of a sync session.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get session ID from query params
    const sessionId = request.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    // Fetch session with unit check for authorization
    const { data: session, error: sessionError } = await supabase
      .from('sync_sessions')
      .select(
        `
        id,
        status,
        pages_visited,
        records_extracted,
        error_log,
        started_at,
        completed_at
      `
      )
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Build progress info based on status
    const pagesVisited = session.pages_visited ?? 0
    const recordsExtracted = session.records_extracted ?? 0

    let progress = null
    if (session.status === 'running') {
      // Estimate phase based on pages visited
      let phase: 'login' | 'roster' | 'profiles' | 'complete' = 'login'
      let message = 'Waiting for login...'
      let percentComplete = 0

      if (pagesVisited > 0) {
        if (recordsExtracted > 0) {
          phase = 'roster'
          message = `Extracted ${recordsExtracted} members`
          percentComplete = Math.min(90, 30 + (recordsExtracted / 100) * 60)
        } else {
          phase = 'roster'
          message = 'Extracting roster data...'
          percentComplete = 30
        }
      }

      progress = {
        phase,
        message,
        current: recordsExtracted,
        total: recordsExtracted || 1,
        percentComplete: Math.round(percentComplete),
      }
    }

    // Build result info for completed sessions
    let result = null
    if (session.status === 'completed') {
      result = {
        success: true,
        session: {
          id: session.id,
          pagesVisited,
          recordsExtracted,
        },
        memberCount: recordsExtracted,
        profileCount: 0,
        errors: session.error_log || [],
      }
    }

    // Build staging info for staged sessions
    let staging = null
    if (session.status === 'staged') {
      try {
        const stagedMembers = await getStagedMembers(supabase, sessionId)

        // Separate scouts and adults
        const scouts = stagedMembers.filter((m) => m.memberType === 'YOUTH')
        const adults = stagedMembers.filter((m) => m.memberType !== 'YOUTH')

        // Scout counts
        const toCreate = scouts.filter((m) => m.changeType === 'create').length
        const toUpdate = scouts.filter((m) => m.changeType === 'update').length
        const toSkip = scouts.filter((m) => m.changeType === 'skip').length

        // Adult counts
        const adultsToCreate = adults.filter((m) => m.changeType === 'create').length
        const adultsToUpdate = adults.filter((m) => m.changeType === 'update').length
        const adultsTotal = adults.length

        staging = {
          members: stagedMembers,
          summary: {
            toCreate,
            toUpdate,
            toSkip,
            total: scouts.length,
            adultsToCreate,
            adultsToUpdate,
            adultsTotal,
          },
        }
      } catch (err) {
        console.error('[Status] Failed to get staged members:', err)
      }
    }

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      pagesVisited,
      recordsExtracted,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      progress,
      result,
      staging,
      error:
        session.status === 'failed'
          ? (session.error_log as { error?: string }[])?.[0]?.error ||
            'Unknown error'
          : null,
    })
  } catch (error) {
    console.error('Status check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
