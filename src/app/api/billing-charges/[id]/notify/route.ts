import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { sendEmail } from '@/lib/email/resend'
import { generateChargeNotificationEmail } from '@/lib/email/templates/charge-notification'
import { randomBytes } from 'crypto'
import { z } from 'zod'

interface RouteParams {
  params: Promise<{ id: string }>
}

const notifySchema = z.object({
  guardianProfileId: z.string().uuid().optional(),
  customMessage: z.string().max(2000).optional(),
})

function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: billingChargeId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only admins and treasurers can send notifications
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can send notifications' },
        { status: 403 }
      )
    }

    // Parse request body
    const rawBody = await request.json().catch(() => ({}))
    const parseResult = notifySchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      )
    }

    const { guardianProfileId, customMessage } = parseResult.data

    // Get billing charge with related data
    // Use 'as unknown as' to bypass TypeScript since is_void columns come from migration
    const { data: chargeData, error: chargeError } = await supabase
      .from('billing_charges')
      .select(`
        id,
        amount,
        is_paid,
        is_void,
        scout_account_id,
        billing_records (
          id,
          description,
          billing_date,
          unit_id,
          is_void
        ),
        scout_accounts (
          id,
          scout_id,
          billing_balance,
          scouts (
            id,
            first_name,
            last_name
          )
        )
      `)
      .eq('id', billingChargeId)
      .single()

    if (chargeError || !chargeData) {
      return NextResponse.json({ error: 'Billing charge not found' }, { status: 404 })
    }

    // Type assertion for migration-added columns
    const charge = chargeData as unknown as {
      id: string
      amount: number
      is_paid: boolean | null
      is_void: boolean | null
      scout_account_id: string
      billing_records: {
        id: string
        description: string
        billing_date: string
        unit_id: string
        is_void: boolean | null
      }
      scout_accounts: {
        id: string
        scout_id: string
        billing_balance: number
        scouts: { id: string; first_name: string; last_name: string }
      }
    }

    const billingRecord = charge.billing_records as {
      id: string
      description: string
      billing_date: string
      unit_id: string
      is_void: boolean | null
    }

    // Verify charge belongs to user's unit
    if (billingRecord.unit_id !== membership.unit_id) {
      return NextResponse.json({ error: 'Billing charge not found' }, { status: 404 })
    }

    if (charge.is_void || billingRecord.is_void) {
      return NextResponse.json({ error: 'Cannot notify for voided charge' }, { status: 400 })
    }

    if (charge.is_paid) {
      return NextResponse.json({ error: 'Cannot notify for already paid charge' }, { status: 400 })
    }

    const scoutAccount = charge.scout_accounts as {
      id: string
      scout_id: string
      billing_balance: number
      scouts: { id: string; first_name: string; last_name: string }
    }

    if (!scoutAccount?.scouts) {
      return NextResponse.json({ error: 'Scout account not found' }, { status: 404 })
    }

    const scout = scoutAccount.scouts
    const scoutName = `${scout.first_name} ${scout.last_name}`

    // Get guardian - specific one or primary
    let guardianQuery = supabase
      .from('scout_guardians')
      .select(`
        profile_id,
        is_primary,
        profiles (
          id,
          email,
          full_name,
          first_name
        )
      `)
      .eq('scout_id', scout.id)

    if (guardianProfileId) {
      guardianQuery = guardianQuery.eq('profile_id', guardianProfileId)
    } else {
      guardianQuery = guardianQuery.order('is_primary', { ascending: false }).limit(1)
    }

    const { data: guardianLink, error: guardianError } = await guardianQuery.single()

    if (guardianError || !guardianLink) {
      return NextResponse.json({ error: 'Guardian not found' }, { status: 404 })
    }

    const guardian = guardianLink.profiles as {
      id: string
      email: string | null
      full_name: string | null
      first_name: string | null
    }

    if (!guardian?.email) {
      return NextResponse.json({ error: 'Guardian has no email address' }, { status: 400 })
    }

    // Get unit info
    const { data: unit } = await supabase
      .from('units')
      .select('name, logo_url')
      .eq('id', membership.unit_id)
      .single()

    // Create payment link for this charge
    const token = generateSecureToken()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .insert({
        unit_id: membership.unit_id,
        scout_account_id: scoutAccount.id,
        billing_charge_id: charge.id,
        amount: Math.round(Number(charge.amount) * 100),
        base_amount: Math.round(Number(charge.amount) * 100),
        fee_amount: 0,
        fees_passed_to_payer: false,
        description: `${billingRecord.description} - ${scoutName}`,
        token,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (linkError || !paymentLink) {
      console.error('Failed to create payment link:', linkError)
      return NextResponse.json(
        { error: 'Failed to create payment link' },
        { status: 500 }
      )
    }

    const paymentUrl = `${baseUrl}/pay/${token}`
    const balance = Number(scoutAccount.billing_balance) || 0
    const availableCredit = balance > 0 ? balance : 0

    // Generate and send email
    const { html, text } = generateChargeNotificationEmail({
      guardianName: guardian.first_name || guardian.full_name || 'Parent',
      scoutName,
      unitName: unit?.name || 'Scout Unit',
      unitLogoUrl: unit?.logo_url,
      chargeDescription: billingRecord.description,
      chargeAmount: Number(charge.amount),
      chargeDate: billingRecord.billing_date,
      currentBalance: balance,
      availableCredit,
      paymentUrl,
      customMessage,
    })

    try {
      await sendEmail({
        to: guardian.email,
        subject: `New Charge: ${billingRecord.description} - ${unit?.name || 'Scout Unit'}`,
        html,
        text,
      })
    } catch (emailError) {
      console.error('Failed to send email:', emailError)
      // Payment link still exists, so return partial success
      return NextResponse.json({
        success: true,
        emailSent: false,
        paymentLinkUrl: paymentUrl,
        message: 'Payment link created but email failed to send',
      })
    }

    return NextResponse.json({
      success: true,
      emailSent: true,
      paymentLinkUrl: paymentUrl,
      guardianEmail: guardian.email,
    })
  } catch (error) {
    console.error('Single charge notify error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}
