import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractReceiptData } from '@/lib/expenses/receipt-ocr'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get request body
    const body = await request.json()
    const { receiptUrl, unitId } = body

    if (!receiptUrl) {
      return NextResponse.json({ error: 'Missing receipt URL' }, { status: 400 })
    }

    if (!unitId) {
      return NextResponse.json({ error: 'Missing unit ID' }, { status: 400 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Verify user has access to this unit
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('unit_id', unitId)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied to this unit' }, { status: 403 })
    }

    // Extract receipt data using Claude Vision
    const result = await extractReceiptData(receiptUrl)

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to extract receipt data',
      })
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    })
  } catch (error) {
    console.error('Receipt extraction error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
