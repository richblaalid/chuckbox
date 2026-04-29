import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { sendEmail } from '@/lib/email/resend'
import { generateChargeNotificationEmail } from '@/lib/email/templates/charge-notification'
import { randomBytes } from 'crypto'

interface RouteParams {
  params: Promise<{ batchId: string }>
}

function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { batchId } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can send notifications' },
        { status: 403 }
      )
    }

    // Verify batch exists and belongs to unit
    const { data: batch } = await supabase
      .from('billing_import_batches')
      .select('id, unit_id, notifications_sent')
      .eq('id', batchId)
      .eq('unit_id', membership.unit_id)
      .single()

    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })
    }

    // Get all billing records in this batch with their charges
    const { data: recordsData } = await supabase
      .from('billing_records')
      .select(`
        id,
        description,
        billing_date,
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
      .eq('billing_import_batch_id', batchId)
      .eq('unit_id', membership.unit_id)

    type BillingRecord = {
      id: string
      description: string
      billing_date: string
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

    const records = (recordsData as unknown as BillingRecord[]) || []

    if (records.length === 0) {
      return NextResponse.json({ error: 'No billing records found in batch' }, { status: 400 })
    }

    // Get unit info
    const { data: unit } = await supabase
      .from('units')
      .select('name, logo_url')
      .eq('id', membership.unit_id)
      .single()

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    let notificationsSent = 0
    const errors: string[] = []

    for (const record of records) {
      if (record.is_void) continue

      const activeCharges = (record.billing_charges || []).filter(
        (charge) => !charge.is_paid && !charge.is_void
      )

      for (const charge of activeCharges) {
        try {
          const scoutAccount = charge.scout_accounts
          if (!scoutAccount?.scouts) continue

          const scout = scoutAccount.scouts
          const scoutName = `${scout.first_name} ${scout.last_name}`

          // Get primary guardian
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

          // Create payment link
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
              description: `${record.description} - ${scoutName}`,
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

          const { html, text } = generateChargeNotificationEmail({
            guardianName: guardian.first_name || guardian.full_name || 'Parent',
            scoutName,
            unitName: unit?.name || 'Scout Unit',
            unitLogoUrl: unit?.logo_url,
            chargeDescription: record.description,
            chargeAmount: Number(charge.amount),
            chargeDate: record.billing_date,
            currentBalance: balance,
            availableCredit,
            paymentUrl,
          })

          await sendEmail({
            to: guardian.email,
            subject: `New Charge: ${record.description} - ${unit?.name || 'Scout Unit'}`,
            html,
            text,
          })

          notificationsSent++
        } catch (chargeError) {
          console.error('Error processing charge notification:', chargeError)
          errors.push('Failed to process a notification')
        }
      }
    }

    // Mark batch as notified
    await supabase
      .from('billing_import_batches')
      .update({ notifications_sent: true })
      .eq('id', batchId)

    return NextResponse.json({
      success: true,
      notificationsSent,
      totalCharges: records.reduce(
        (sum, r) => sum + (r.billing_charges || []).filter((c) => !c.is_paid && !c.is_void).length,
        0
      ),
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Batch notify error:', error)
    return NextResponse.json(
      { error: 'Failed to send notifications' },
      { status: 500 }
    )
  }
}
