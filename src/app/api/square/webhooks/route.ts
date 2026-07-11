import { NextRequest, NextResponse } from 'next/server'
import { WebhooksHelper } from 'square'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'

// Use admin client for webhook processing (no user session)
function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration')
  }

  return createAdminClient<Database>(supabaseUrl, supabaseServiceKey)
}

function getWebhookSignatureKey(): string {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!key) {
    throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY environment variable is not set')
  }
  return key
}

function getWebhookUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${baseUrl}/api/square/webhooks`
}

interface SquareWebhookEvent {
  merchant_id: string
  type: string
  event_id: string
  created_at: string
  data: {
    type: string
    id: string
    object: {
      payment?: SquarePaymentObject
      refund?: SquareRefundObject
    }
  }
}

interface SquarePaymentObject {
  id: string
  created_at: string
  updated_at: string
  amount_money: { amount: number; currency: string }
  total_money: { amount: number; currency: string }
  processing_fee?: Array<{ amount_money: { amount: number; currency: string } }>
  status: string
  source_type: string
  card_details?: {
    card: {
      card_brand: string
      last_4: string
    }
  }
  location_id: string
  order_id?: string
  reference_id?: string
  receipt_url?: string
  receipt_number?: string
}

interface SquareRefundObject {
  id: string
  payment_id: string
  amount_money: { amount: number; currency: string }
  status: string
  created_at: string
  reason?: string
}

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const rawBody = await request.text()

    // Verify webhook signature
    const signatureHeader = request.headers.get('x-square-hmacsha256-signature')

    if (!signatureHeader) {
      logger.square.error('Missing Square webhook signature header')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const isValid = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader,
      signatureKey: getWebhookSignatureKey(),
      notificationUrl: getWebhookUrl(),
    })

    if (!isValid) {
      logger.square.error('Invalid Square webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Parse the event
    const event: SquareWebhookEvent = JSON.parse(rawBody)

    // Get the unit associated with this merchant
    const supabase = getAdminSupabase()
    const { data: credentials } = await supabase
      .from('unit_square_credentials')
      .select('unit_id')
      .eq('merchant_id', event.merchant_id)
      .eq('is_active', true)
      .single()

    if (!credentials) {
      console.warn(`No unit found for merchant ${event.merchant_id}`)
      // Return success to prevent retries for unknown merchants
      return NextResponse.json({ received: true })
    }

    const unitId = credentials.unit_id

    // Handle different event types
    switch (event.type) {
      case 'payment.completed':
      case 'payment.updated':
        await handlePaymentEvent(supabase, unitId, event)
        break

      case 'refund.created':
      case 'refund.updated':
        await handleRefundEvent(supabase, unitId, event)
        break

      case 'oauth.authorization.revoked':
        await handleOAuthRevoked(supabase, unitId, event)
        break

      default:
        // Unhandled event type - ignore
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.square.error('Square webhook error', error)
    // Return 200 to prevent retries for processing errors
    // Square will retry on 4xx/5xx responses
    return NextResponse.json({ received: true, error: 'Processing error' })
  }
}

async function handlePaymentEvent(
  supabase: ReturnType<typeof getAdminSupabase>,
  unitId: string,
  event: SquareWebhookEvent
) {
  const payment = event.data.object.payment
  if (!payment) {
    console.warn('Payment event missing payment object')
    return
  }

  // Calculate fee from processing fees
  const feeCents = payment.processing_fee?.reduce(
    (sum, fee) => sum + (fee.amount_money?.amount || 0),
    0
  ) || 0

  const amountCents = payment.amount_money?.amount || 0
  const netCents = amountCents - feeCents

  // Check if we already have this transaction
  const { data: existingTransaction } = await supabase
    .from('square_transactions')
    .select('id, is_reconciled')
    .eq('unit_id', unitId)
    .eq('square_payment_id', payment.id)
    .single()

  const transactionData = {
    unit_id: unitId,
    square_payment_id: payment.id,
    square_order_id: payment.order_id || null,
    amount_money: amountCents,
    fee_money: feeCents,
    net_money: netCents,
    currency: payment.amount_money?.currency || 'USD',
    status: payment.status,
    source_type: payment.source_type,
    card_brand: payment.card_details?.card?.card_brand || null,
    last_4: payment.card_details?.card?.last_4 || null,
    receipt_url: payment.receipt_url || null,
    receipt_number: payment.receipt_number || null,
    square_created_at: payment.created_at,
  }

  if (existingTransaction) {
    // Update existing transaction
    await supabase
      .from('square_transactions')
      .update({
        ...transactionData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingTransaction.id)
  } else {
    // Insert new transaction (may have been created via external Square payment)
    await supabase.from('square_transactions').insert({
      ...transactionData,
      is_reconciled: false,
      synced_at: new Date().toISOString(),
    })
  }
}

async function handleRefundEvent(
  supabase: ReturnType<typeof getAdminSupabase>,
  unitId: string,
  event: SquareWebhookEvent
) {
  const refund = event.data.object.refund
  if (!refund) {
    console.warn('Refund event missing refund object')
    return
  }

  // Find the original payment
  const { data: originalTransaction } = await supabase
    .from('square_transactions')
    .select('id, payment_id, scout_account_id')
    .eq('unit_id', unitId)
    .eq('square_payment_id', refund.payment_id)
    .single()

  if (!originalTransaction) {
    console.warn(`Original payment ${refund.payment_id} not found for refund ${refund.id}`)
    return
  }

  // Update original transaction status
  await supabase
    .from('square_transactions')
    .update({
      status: 'REFUNDED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', originalTransaction.id)

  // If we have a linked payment record, update it too
  if (originalTransaction.payment_id) {
    await supabase
      .from('payments')
      .update({ status: 'refunded' })
      .eq('id', originalTransaction.payment_id)
  }

  // Create reversal journal entry for the refund if we have a scout account
  if (originalTransaction.scout_account_id) {
    const refundAmountCents = refund.amount_money?.amount || 0

    const { error: journalError } = await supabase.rpc('create_refund_journal_entry', {
      p_unit_id: unitId,
      p_scout_account_id: originalTransaction.scout_account_id,
      p_refund_amount_cents: refundAmountCents,
      p_square_refund_id: refund.id,
      p_original_square_payment_id: refund.payment_id,
      p_refund_reason: refund.reason || undefined,
    })

    if (journalError) {
      logger.square.error(`Failed to create refund journal entry for ${refund.id}`, journalError)
      // Don't throw - the refund itself is processed, just log the accounting error
    }
  }
}

async function handleOAuthRevoked(
  supabase: ReturnType<typeof getAdminSupabase>,
  unitId: string,
  event: SquareWebhookEvent
) {
  // Mark the Square credentials as inactive
  await supabase
    .from('unit_square_credentials')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('unit_id', unitId)
}
