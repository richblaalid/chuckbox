import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { disconnectPlaid } from '@/lib/plaid/client'

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

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can disconnect bank accounts' },
        { status: 403 }
      )
    }

    // Disconnect Plaid
    await disconnectPlaid(membership.unit_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting Plaid:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect bank account' },
      { status: 500 }
    )
  }
}
