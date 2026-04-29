import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { getPlaidTransactions } from '@/lib/plaid/client'

export async function GET(request: NextRequest) {
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
    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Only financial roles can view transactions
    if (!['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can view bank transactions' },
        { status: 403 }
      )
    }

    // Parse date range from query params
    const { searchParams } = new URL(request.url)
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')

    // Default to last 30 days
    const endDate = endDateParam || new Date().toISOString().split('T')[0]
    const startDate =
      startDateParam ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Get transactions from Plaid
    const result = await getPlaidTransactions(membership.unit_id, startDate, endDate)

    if (!result) {
      return NextResponse.json({ transactions: [], accounts: [] })
    }

    // Format transactions for frontend
    const transactions = result.transactions.map((t) => ({
      id: t.transaction_id,
      date: t.date,
      name: t.name,
      merchant_name: t.merchant_name,
      amount: t.amount,
      category: t.category,
      pending: t.pending,
      account_id: t.account_id,
    }))

    // Include account info for display
    const accounts = result.accounts.map((a) => ({
      account_id: a.account_id,
      name: a.name,
      mask: a.mask,
    }))

    return NextResponse.json({
      transactions,
      accounts,
      total_transactions: result.totalTransactions,
      start_date: startDate,
      end_date: endDate,
    })
  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    )
  }
}
