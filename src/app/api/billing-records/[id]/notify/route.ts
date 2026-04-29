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
  customMessage: z.string().max(2000).optional(),
})

function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: billingRecordId } = await params
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
    const customMessage = parseResult.success ? parseResult.data.customMessage : undefined

    // Get billing record with charges
    // Use type assertion to bypass TypeScript since is_void columns come from migration
    const { data: recordData, error: recordError } = await supabase
      .from('billing_records')
      .select(`
        id,
        description,
        billing_date,
        unit_id,
        is_void,
        billing_charges (
          id,
          amount,
          is_paid,
          is_void,
          scout_account_id,
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
        )
      `)
      .eq('id', billingRecordId)
      .eq('unit_id', membership.unit_id)
      .single()

    if (recordError || !recordData) {
      return NextResponse.json({ error: 'Billing record not found' }, { status: 404 })
    }

    // Type assertion for migration-added columns
    const billingRecord = recordData as unknown as {
      id: string
      description: string
      billing_date: string
      unit_id: string
      is_void: boolean | null
      billing_charges: Array<{
        id: string
        amount: number
        is_paid: boolean | null
        is_void: boolean | null
        scout_account_id: string
        scout_accounts: {
          id: string
          scout_id: string
          billing_balance: number
          scouts: { id: string; first_name: string; last_name: string }
        }
      }>
    }

    if (billingRecord.is_void) {
      return NextResponse.json({ error: 'Cannot notify for voided billing record' }, { status: 400 })
    }

    // Get unit info
    const { data: unit } = await supabase
      .from('units')
      .select('name, logo_url')
      .eq('id', membership.unit_id)
      .single()

    // Filter to unpaid, non-voided charges
    const activeCharges = (billingRecord.billing_charges || []).filter(
      (charge: { is_paid: boolean | null; is_void: boolean | null }) =>
        !charge.is_paid && !charge.is_void
    )

    if (activeCharges.length === 0) {
      return NextResponse.json({ error: 'No unpaid charges to notify about' }, { status: 400 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    let notificationsSent = 0
    const errors: string[] = []

    // Process each charge
    for (const charge of activeCharges) {
      try {
        const scoutAccount = charge.scout_accounts as {
          id: string
          scout_id: string
          billing_balance: number
          scouts: { id: string; first_name: string; last_name: string }
        }

        if (!scoutAccount?.scouts) continue

        const scout = scoutAccount.scouts
        const scoutName = `${scout.first_name} ${scout.last_name}`

        // Get primary guardian for this scout
        const { data: guardianLink } = await supabase
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
          .order('is_primary', { ascending: false })
          .limit(1)
          .single()

        if (!guardianLink) {
          errors.push(`No guardian found for ${scoutName}`)
          continue
        }

        const guardian = guardianLink.profiles as {
          id: string
          email: string | null
          full_name: string | null
          first_name: string | null
        }

        if (!guardian?.email) {
          errors.push(`No email for ${scoutName}'s guardian`)
          continue
        }

        // Create payment link for this charge
        const token = generateSecureToken()
        const { error: linkError } = await supabase
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

        if (linkError) {
          errors.push(`Failed to create payment link for ${scoutName}`)
          continue
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

        await sendEmail({
          to: guardian.email,
          subject: `New Charge: ${billingRecord.description} - ${unit?.name || 'Scout Unit'}`,
          html,
          text,
        })

        notificationsSent++
      } catch (chargeError) {
        console.error('Error processing charge notification:', chargeError)
        errors.push(`Failed to process notification for a charge`)
      }
    }

    return NextResponse.json({
      success: true,
      notificationsSent,
      totalCharges: activeCharges.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Bulk notify error:', error)
    return NextResponse.json(
      { error: 'Failed to send notifications' },
      { status: 500 }
    )
  }
}
