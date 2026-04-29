import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import { sendEmail } from '@/lib/email/resend'
import { generatePaymentReminderEmail } from '@/lib/email/templates/payment-reminder'
import { canPerformAction } from '@/lib/roles'
import { randomBytes } from 'crypto'

function generateSecureToken(): string {
  return randomBytes(32).toString('hex') // 64 characters
}

interface SendRemindersRequest {
  unitId: string
  accountIds: string[]
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const body: SendRemindersRequest = await request.json()
    const { unitId, accountIds } = body

    if (!unitId || !accountIds || accountIds.length === 0) {
      return NextResponse.json(
        { error: 'unitId and accountIds are required' },
        { status: 400 }
      )
    }

    // Authorize against the body's unitId. The helper's "fallback to first
    // membership" is unsafe here, so we explicitly verify membership.unit_id
    // matches the body's unitId — preserves the original `.eq('unit_id', unitId)`
    // semantics.
    const membership = await getCurrentMembership(supabase, unitId)
    if (
      !membership ||
      membership.unit_id !== unitId ||
      !canPerformAction(membership.role, 'manage_billing')
    ) {
      return NextResponse.json(
        { error: 'You do not have permission to send reminders for this unit' },
        { status: 403 }
      )
    }

    // The helper doesn't return the unit name, so query separately for display.
    const { data: unitRow } = await supabase
      .from('units')
      .select('name')
      .eq('id', unitId)
      .single()
    const unitName = unitRow?.name || 'Your Scout Unit'

    // Get account details with scout and guardian info
    const { data: accountsData, error: accountsError } = await supabase
      .from('scout_accounts')
      .select(`
        id,
        billing_balance,
        scouts (
          id,
          first_name,
          last_name
        )
      `)
      .in('id', accountIds)
      .eq('unit_id', unitId)
      .lt('billing_balance', 0)

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError)
      return NextResponse.json(
        { error: 'Failed to fetch account details' },
        { status: 500 }
      )
    }

    if (!accountsData || accountsData.length === 0) {
      return NextResponse.json(
        { error: 'No valid accounts found' },
        { status: 400 }
      )
    }

    // Get oldest unpaid charge date for each account (for days overdue calculation)
    const { data: unpaidChargesData } = await supabase
      .from('billing_charges')
      .select(`
        scout_account_id,
        billing_records!inner (
          billing_date
        )
      `)
      .in('scout_account_id', accountIds)
      .eq('is_paid', false)
      .or('is_void.is.null,is_void.eq.false')
      .order('billing_records(billing_date)', { ascending: true })

    interface UnpaidCharge {
      scout_account_id: string
      billing_records: { billing_date: string }
    }

    const oldestChargesByAccount: Record<string, string> = {}
    for (const charge of (unpaidChargesData as UnpaidCharge[]) || []) {
      if (!oldestChargesByAccount[charge.scout_account_id]) {
        oldestChargesByAccount[charge.scout_account_id] = charge.billing_records.billing_date
      }
    }

    // Get guardians for each scout
    const scoutIds = accountsData.map(a => (a.scouts as { id: string })?.id).filter(Boolean)

    const { data: guardiansData } = await supabase
      .from('scout_guardians')
      .select(`
        scout_id,
        profiles (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .in('scout_id', scoutIds)

    interface GuardianRow {
      scout_id: string
      profiles: {
        id: string
        email: string | null
        first_name: string | null
        last_name: string | null
      } | null
    }

    const guardiansByScout: Record<string, GuardianRow[]> = {}
    for (const g of (guardiansData as GuardianRow[]) || []) {
      if (!guardiansByScout[g.scout_id]) {
        guardiansByScout[g.scout_id] = []
      }
      guardiansByScout[g.scout_id].push(g)
    }

    // Calculate days overdue
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Send emails
    const results: { accountId: string; email: string; success: boolean; error?: string }[] = []
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://chuckbox.app'

    for (const account of accountsData) {
      const scout = account.scouts as { id: string; first_name: string; last_name: string } | null
      if (!scout) continue

      const guardians = guardiansByScout[scout.id] || []
      const guardiansWithEmail = guardians.filter(g => g.profiles?.email)

      if (guardiansWithEmail.length === 0) {
        results.push({
          accountId: account.id,
          email: '',
          success: false,
          error: 'No guardian email on file',
        })
        continue
      }

      // Calculate days overdue
      const oldestDate = oldestChargesByAccount[account.id]
      let daysOverdue = 0
      if (oldestDate) {
        const chargeDate = new Date(oldestDate)
        chargeDate.setHours(0, 0, 0, 0)
        daysOverdue = Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24))
      }

      // Send to each guardian
      for (const guardian of guardiansWithEmail) {
        const guardianEmail = guardian.profiles?.email
        if (!guardianEmail) continue

        const guardianName = guardian.profiles?.first_name || guardianEmail.split('@')[0]
        const scoutName = `${scout.first_name} ${scout.last_name}`

        // Create a payment link for this account (like payment request emails do)
        const token = generateSecureToken()
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiration

        const amountCents = Math.round(Math.abs(account.billing_balance || 0) * 100)

        const { error: linkError } = await supabase
          .from('payment_links')
          .insert({
            unit_id: unitId,
            scout_account_id: account.id,
            amount: amountCents,
            base_amount: amountCents,
            fee_amount: 0,
            fees_passed_to_payer: false,
            description: `Payment reminder for ${scoutName}`,
            token,
            status: 'pending',
            expires_at: expiresAt.toISOString(),
          })

        if (linkError) {
          console.error(`Failed to create payment link for ${account.id}:`, linkError)
          results.push({
            accountId: account.id,
            email: guardianEmail,
            success: false,
            error: 'Failed to create payment link',
          })
          continue
        }

        const paymentUrl = `${baseUrl}/pay/${token}`

        const emailContent = generatePaymentReminderEmail({
          guardianName,
          scoutName,
          unitName,
          amountDue: Math.abs(account.billing_balance || 0),
          daysOverdue,
          paymentUrl,
        })

        try {
          await sendEmail({
            to: guardianEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          })

          results.push({
            accountId: account.id,
            email: guardianEmail,
            success: true,
          })
        } catch (emailError) {
          console.error(`Failed to send email to ${guardianEmail}:`, emailError)
          results.push({
            accountId: account.id,
            email: guardianEmail,
            success: false,
            error: emailError instanceof Error ? emailError.message : 'Email send failed',
          })
        }
      }
    }

    const successCount = results.filter(r => r.success).length
    const failureCount = results.filter(r => !r.success).length

    return NextResponse.json({
      success: true,
      sent: successCount,
      failed: failureCount,
      results,
    })
  } catch (error) {
    console.error('Error in send-reminders API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
