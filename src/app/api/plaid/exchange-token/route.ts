import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { exchangePublicToken } from '@/lib/plaid/client'

interface ExchangeTokenRequest {
  public_token: string
  institution: {
    institution_id: string
    name: string
  }
  accounts: Array<{
    id: string
    name: string
    mask: string | null
    type: string
    subtype: string | null
  }>
}

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
    if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can connect bank accounts' },
        { status: 403 }
      )
    }

    // Parse request body
    const body: ExchangeTokenRequest = await request.json()

    if (!body.public_token || !body.institution || !body.accounts) {
      return NextResponse.json(
        { error: 'Missing required fields: public_token, institution, accounts' },
        { status: 400 }
      )
    }

    // Exchange public token and store connection
    const connection = await exchangePublicToken(
      membership.unit_id,
      body.public_token,
      body.institution.institution_id,
      body.institution.name,
      body.accounts
    )

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        institution_name: connection.institution_name,
        accounts: connection.accounts,
        status: connection.status,
      },
    })
  } catch (error) {
    console.error('Error exchanging token:', error)
    return NextResponse.json(
      { error: 'Failed to connect bank account' },
      { status: 500 }
    )
  }
}
