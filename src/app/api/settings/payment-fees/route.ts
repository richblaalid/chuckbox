import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import { z } from 'zod'

// Zod schema for fee settings validation
const updateFeeSettingsSchema = z.object({
  unitId: z.string().uuid('Invalid unit ID'),
  processingFeePercent: z.number().min(0, 'Fee percentage cannot be negative').max(0.1, 'Fee percentage cannot exceed 10%'),
  processingFeeFixed: z.number().min(0, 'Fixed fee cannot be negative').max(1, 'Fixed fee cannot exceed $1.00'),
  passFeesToPayer: z.boolean(),
})

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

    // Parse and validate request body
    const rawBody = await request.json()
    const parseResult = updateFeeSettingsSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const { unitId, processingFeePercent, processingFeeFixed, passFeesToPayer } = parseResult.data

    // Authorize against the body's unitId. Explicit `membership.unit_id ===
    // unitId` check preserves the original `.eq('unit_id', unitId)` semantics —
    // the helper's fallback-to-first-membership is unsafe for body-driven auth.
    const membership = await getCurrentMembership(supabase, unitId)
    if (!membership || membership.unit_id !== unitId || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only unit administrators can update fee settings' },
        { status: 403 }
      )
    }

    // Update the unit's fee settings
    const { error: updateError } = await supabase
      .from('units')
      .update({
        processing_fee_percent: processingFeePercent,
        processing_fee_fixed: processingFeeFixed,
        pass_fees_to_payer: passFeesToPayer,
      })
      .eq('id', unitId)

    if (updateError) {
      console.error('Failed to update fee settings:', updateError)
      return NextResponse.json(
        { error: 'Failed to update fee settings' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      settings: {
        processingFeePercent,
        processingFeeFixed,
        passFeesToPayer,
      },
    })
  } catch (error) {
    console.error('Update fee settings error:', error)
    return NextResponse.json(
      { error: 'Failed to update fee settings' },
      { status: 500 }
    )
  }
}
