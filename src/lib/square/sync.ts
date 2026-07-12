import { getSquareClientForUnit, getDefaultLocationId } from './client'
import { createClient } from '../supabase/server'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'

type SquareTransaction = Database['public']['Tables']['square_transactions']['Insert']
type OrderLineItem = { name: string; quantity: number; amount: number }

interface SyncResult {
  success: boolean
  synced: number
  errors: string[]
}

export async function syncSquareTransactions(
  unitId: string,
  options?: {
    startDate?: Date
    endDate?: Date
    limit?: number
  }
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: 0,
    errors: [],
  }

  try {
    const squareClient = await getSquareClientForUnit(unitId)
    if (!squareClient) {
      return {
        success: false,
        synced: 0,
        errors: ['Square is not connected for this unit'],
      }
    }

    const locationId = await getDefaultLocationId(unitId)
    if (!locationId) {
      return {
        success: false,
        synced: 0,
        errors: ['No Square location found'],
      }
    }

    // Default to last 90 days if no date range specified
    const endDate = options?.endDate || new Date()
    const startDate = options?.startDate || new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000)

    // Format dates for Square API (RFC 3339)
    const beginTime = startDate.toISOString()
    const endTime = endDate.toISOString()

    // Fetch payments from Square
    const paymentsPage = await squareClient.payments.list({
      locationId,
      beginTime,
      endTime,
      limit: options?.limit || 100,
      sortOrder: 'DESC',
    })

    const payments = paymentsPage.data || []
    const supabase = await createClient()

    // Get existing transactions for this unit to avoid duplicates
    const { data: existingTransactions } = await supabase
      .from('square_transactions')
      .select('square_payment_id')
      .eq('unit_id', unitId)

    const existingIds = new Set((existingTransactions || []).map((t) => t.square_payment_id))

    // Batch fetch orders for payments that have orderId
    const orderIds = payments
      .filter((p) => p.orderId)
      .map((p) => p.orderId as string)

    const ordersMap = new Map<string, OrderLineItem[]>()

    if (orderIds.length > 0) {
      try {
        // Fetch orders in batches of 10
        for (let i = 0; i < orderIds.length; i += 10) {
          const batch = orderIds.slice(i, i + 10)
          const ordersResponse = await squareClient.orders.batchGet({
            locationId,
            orderIds: batch,
          })

          for (const order of ordersResponse.orders || []) {
            if (order.id && order.lineItems) {
              const lineItems: OrderLineItem[] = order.lineItems.map((item) => ({
                name: item.name || 'Unknown Item',
                quantity: Number(item.quantity) || 1,
                amount: Number(item.totalMoney?.amount || 0) / 100,
              }))
              ordersMap.set(order.id, lineItems)
            }
          }
        }
      } catch (orderError) {
        // Log but don't fail sync if order fetch fails
        logger.square.error('Failed to fetch orders', orderError)
      }
    }

    // Batch fetch customers for payments that have customerId
    const customerIds = [...new Set(
      payments
        .filter((p) => p.customerId)
        .map((p) => p.customerId as string)
    )]

    const customersMap = new Map<string, { name: string | null; email: string | null }>()

    if (customerIds.length > 0) {
      try {
        // Fetch customers individually (Square doesn't have batch get for customers)
        for (const customerId of customerIds) {
          try {
            const customerResponse = await squareClient.customers.get({ customerId })
            const customer = customerResponse.customer
            if (customer) {
              const name = [customer.givenName, customer.familyName]
                .filter(Boolean)
                .join(' ') || null
              customersMap.set(customerId, {
                name,
                email: customer.emailAddress || null,
              })
            }
          } catch {
            // Skip individual customer fetch errors
          }
        }
      } catch (customerError) {
        // Log but don't fail sync if customer fetch fails
        logger.square.error('Failed to fetch customers', customerError)
      }
    }

    // Process each payment
    for (const payment of payments) {
      try {
        if (!payment.id) continue

        // Calculate fee
        const feeCents = payment.processingFee?.reduce(
          (sum, fee) => sum + Number(fee.amountMoney?.amount || 0),
          0
        ) || 0

        const amountCents = Number(payment.amountMoney?.amount || 0)
        const netCents = amountCents - feeCents

        // Get order line items if available
        const orderLineItems = payment.orderId
          ? ordersMap.get(payment.orderId) || null
          : null

        // Get customer info from Square Customer record if available
        const customerData = payment.customerId
          ? customersMap.get(payment.customerId)
          : null

        const transactionData: SquareTransaction = {
          unit_id: unitId,
          square_payment_id: payment.id,
          square_order_id: payment.orderId || null,
          amount_money: amountCents,
          fee_money: feeCents,
          net_money: netCents,
          currency: payment.amountMoney?.currency || 'USD',
          status: payment.status || 'UNKNOWN',
          source_type: payment.sourceType || null,
          card_brand: payment.cardDetails?.card?.cardBrand || null,
          last_4: payment.cardDetails?.card?.last4 || null,
          receipt_url: payment.receiptUrl || null,
          receipt_number: payment.receiptNumber || null,
          is_reconciled: false,
          square_created_at: payment.createdAt || new Date().toISOString(),
          synced_at: new Date().toISOString(),
          // Prefer customer record data, fall back to payment-level data
          buyer_email_address: customerData?.email || payment.buyerEmailAddress || null,
          cardholder_name: customerData?.name || payment.cardDetails?.card?.cardholderName || null,
          note: payment.note || null,
          order_line_items: orderLineItems,
        }

        if (existingIds.has(payment.id)) {
          // Update existing transaction
          const { error } = await supabase
            .from('square_transactions')
            .update({
              ...transactionData,
              updated_at: new Date().toISOString(),
            })
            .eq('unit_id', unitId)
            .eq('square_payment_id', payment.id)

          if (error) {
            result.errors.push(`Failed to update ${payment.id}: ${error.message}`)
          } else {
            result.synced++
          }
        } else {
          // Insert new transaction
          const { error } = await supabase
            .from('square_transactions')
            .insert(transactionData)

          if (error) {
            result.errors.push(`Failed to insert ${payment.id}: ${error.message}`)
          } else {
            result.synced++
            existingIds.add(payment.id)
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        result.errors.push(`Failed to process payment ${payment.id}: ${errorMessage}`)
      }
    }

    // Update last_sync_at timestamp
    await supabase
      .from('unit_square_credentials')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('unit_id', unitId)

    result.success = result.errors.length === 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    result.success = false
    result.errors.push(`Sync failed: ${errorMessage}`)
  }

  return result
}

export async function getUnreconciledTransactions(unitId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('square_transactions')
    .select(`
      *,
      payments (
        id,
        amount,
        scout_account_id
      )
    `)
    .eq('unit_id', unitId)
    .eq('is_reconciled', false)
    .order('square_created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Failed to fetch unreconciled transactions: ${error.message}`)
  }

  return data || []
}

export async function reconcileTransaction(
  transactionId: string,
  scoutAccountId?: string
) {
  const supabase = await createClient()

  const updateData: { is_reconciled: boolean; scout_account_id?: string } = {
    is_reconciled: true,
  }

  if (scoutAccountId) {
    updateData.scout_account_id = scoutAccountId
  }

  const { error } = await supabase
    .from('square_transactions')
    .update(updateData)
    .eq('id', transactionId)

  if (error) {
    throw new Error(`Failed to reconcile transaction: ${error.message}`)
  }
}
