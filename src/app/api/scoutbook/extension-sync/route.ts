import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { validateExtensionToken } from '@/lib/auth/extension-auth'
import { parseRosterHtmlWithAI, isValidRosterHtml } from '@/lib/sync/scoutbook/ai-parser'
import { stageRosterMembers } from '@/lib/sync/scoutbook'

const MAX_HTML_SIZE = 5 * 1024 * 1024 // 5MB
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 10 // 10 syncs per hour

// Simple in-memory rate limiting (for production, use Redis)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(profileId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(profileId)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(profileId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

function getServiceClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/scoutbook/extension-sync
 *
 * Receives roster HTML from the browser extension and processes it.
 *
 * Authentication: Either session cookie or Bearer token
 * Body: { html: string }
 */
export async function POST(request: Request) {
  try {
    let profileId: string
    let unitId: string

    // Try to authenticate via session cookie first
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      // Session-based auth
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
      }

      const { data: membership } = await supabase
        .from('unit_memberships')
        .select('unit_id, role')
        .eq('profile_id', profile.id)
        .eq('status', 'active')
        .single()

      if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
        return NextResponse.json(
          { error: 'Only unit administrators can sync from Scoutbook' },
          { status: 403 }
        )
      }

      profileId = profile.id
      unitId = membership.unit_id
    } else {
      // Try Bearer token auth
      const authHeader = request.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const token = authHeader.slice(7)
      const serviceClient = getServiceClient()
      const tokenData = await validateExtensionToken(serviceClient, token)

      if (!tokenData) {
        return NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        )
      }

      profileId = tokenData.profileId
      unitId = tokenData.unitId
    }

    // Check rate limit
    if (!checkRateLimit(profileId)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 10 syncs per hour.' },
        { status: 429 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { html } = body

    if (!html || typeof html !== 'string') {
      return NextResponse.json(
        { error: 'HTML content required' },
        { status: 400 }
      )
    }

    if (html.length > MAX_HTML_SIZE) {
      return NextResponse.json(
        { error: `HTML exceeds maximum size of ${MAX_HTML_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Validate HTML looks like a roster page
    if (!isValidRosterHtml(html)) {
      return NextResponse.json(
        { error: 'HTML does not appear to be a valid Scoutbook roster page' },
        { status: 400 }
      )
    }

    // Create sync session
    const serviceClient = getServiceClient()
    const { data: session, error: sessionError } = await serviceClient
      .from('sync_sessions')
      .insert({
        unit_id: unitId,
        status: 'running',
        created_by: profileId,
        sync_source: 'extension',
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

    // Parse HTML with AI
    const parseResult = await parseRosterHtmlWithAI(html)

    if (parseResult.members.length === 0) {
      // Update session as failed
      await serviceClient
        .from('sync_sessions')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_log: [
            {
              timestamp: new Date().toISOString(),
              error: parseResult.error || 'No members found in HTML',
              usedAI: parseResult.usedAI,
            },
          ],
        })
        .eq('id', session.id)

      return NextResponse.json(
        {
          error: 'Failed to extract roster members from HTML',
          details: parseResult.error,
        },
        { status: 400 }
      )
    }

    // Stage members for review
    const stagingResult = await stageRosterMembers(
      serviceClient,
      session.id,
      unitId,
      parseResult.members
    )

    // Update session to staged status
    await serviceClient
      .from('sync_sessions')
      .update({
        status: 'staged',
        completed_at: new Date().toISOString(),
        records_extracted: parseResult.members.length,
      })
      .eq('id', session.id)

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      staging: {
        toCreate: stagingResult.toCreate,
        toUpdate: stagingResult.toUpdate,
        toSkip: stagingResult.toSkip,
        total: stagingResult.total,
        adultsToCreate: stagingResult.adultsToCreate,
        adultsToUpdate: stagingResult.adultsToUpdate,
        adultsTotal: stagingResult.adultsTotal,
      },
      usedAI: parseResult.usedAI,
      message: 'Roster parsed and staged for review',
    })
  } catch (error) {
    console.error('Extension sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS /api/scoutbook/extension-sync
 *
 * Handle CORS preflight for extension requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}
