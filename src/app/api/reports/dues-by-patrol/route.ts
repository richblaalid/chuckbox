import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage } from '@/lib/roles'

interface PatrolDuesData {
  patrol_name: string
  scout_count: number
  total_billed: number
  total_paid: number
  total_outstanding: number
  scouts: {
    scout_id: string
    scout_name: string
    billing_balance: number
    funds_balance: number
  }[]
}

interface DuesByPatrolData {
  startDate: string
  endDate: string
  patrols: PatrolDuesData[]
  totals: {
    total_scouts: number
    total_billed: number
    total_paid: number
    total_outstanding: number
  }
}

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

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Get user's active membership
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Check role-based access
    if (!canAccessPage(membership.role, 'reports')) {
      return NextResponse.json(
        { error: 'You do not have permission to view reports' },
        { status: 403 }
      )
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')

    // Default to current fiscal year if no dates provided
    const today = new Date()
    const defaultStartDate = `${today.getFullYear()}-01-01`
    const defaultEndDate = today.toISOString().split('T')[0]

    const startDate = startDateParam || defaultStartDate
    const endDate = endDateParam || defaultEndDate

    // Get all scout accounts with their scouts and patrols
    const { data: accountsData, error: accountsError } = await supabase
      .from('scout_accounts')
      .select(`
        id,
        billing_balance,
        funds_balance,
        scouts!inner (
          id,
          first_name,
          last_name,
          is_active,
          patrols (
            id,
            name
          )
        )
      `)
      .eq('unit_id', membership.unit_id)

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError)
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    interface AccountRow {
      id: string
      billing_balance: number | null
      funds_balance: number | null
      scouts: {
        id: string
        first_name: string
        last_name: string
        is_active: boolean | null
        patrols: { id: string; name: string } | null
      }
    }

    // Get billing records for the date range
    const { data: billingData, error: billingError } = await supabase
      .from('billing_charges')
      .select(`
        id,
        amount,
        is_paid,
        is_void,
        scout_account_id,
        billing_records!inner (
          billing_date,
          unit_id
        )
      `)
      .eq('billing_records.unit_id', membership.unit_id)
      .gte('billing_records.billing_date', startDate)
      .lte('billing_records.billing_date', endDate)
      .or('is_void.is.null,is_void.eq.false')

    if (billingError) {
      console.error('Error fetching billing:', billingError)
      return NextResponse.json({ error: 'Failed to fetch billing data' }, { status: 500 })
    }

    interface BillingChargeRow {
      id: string
      amount: number
      is_paid: boolean | null
      is_void: boolean | null
      scout_account_id: string
      billing_records: {
        billing_date: string
        unit_id: string
      }
    }

    // Calculate billing totals per scout account
    const billingByAccount: Record<string, { billed: number; paid: number }> = {}
    for (const charge of (billingData as BillingChargeRow[]) || []) {
      if (!billingByAccount[charge.scout_account_id]) {
        billingByAccount[charge.scout_account_id] = { billed: 0, paid: 0 }
      }
      billingByAccount[charge.scout_account_id].billed += charge.amount
      if (charge.is_paid) {
        billingByAccount[charge.scout_account_id].paid += charge.amount
      }
    }

    // Group accounts by patrol
    const patrolGroups: Record<string, PatrolDuesData> = {}

    for (const account of (accountsData as AccountRow[]) || []) {
      const patrolName = account.scouts?.patrols?.name || 'No Patrol'

      if (!patrolGroups[patrolName]) {
        patrolGroups[patrolName] = {
          patrol_name: patrolName,
          scout_count: 0,
          total_billed: 0,
          total_paid: 0,
          total_outstanding: 0,
          scouts: [],
        }
      }

      const billing = billingByAccount[account.id] || { billed: 0, paid: 0 }
      const outstanding = billing.billed - billing.paid

      patrolGroups[patrolName].scout_count += 1
      patrolGroups[patrolName].total_billed += billing.billed
      patrolGroups[patrolName].total_paid += billing.paid
      patrolGroups[patrolName].total_outstanding += outstanding

      patrolGroups[patrolName].scouts.push({
        scout_id: account.scouts.id,
        scout_name: `${account.scouts.first_name} ${account.scouts.last_name}`,
        billing_balance: account.billing_balance || 0,
        funds_balance: account.funds_balance || 0,
      })
    }

    // Sort patrols and scouts
    const patrols = Object.values(patrolGroups)
      .sort((a, b) => a.patrol_name.localeCompare(b.patrol_name))
      .map(patrol => ({
        ...patrol,
        scouts: patrol.scouts.sort((a, b) => a.scout_name.localeCompare(b.scout_name)),
      }))

    // Calculate totals
    const totals = patrols.reduce(
      (acc, patrol) => ({
        total_scouts: acc.total_scouts + patrol.scout_count,
        total_billed: acc.total_billed + patrol.total_billed,
        total_paid: acc.total_paid + patrol.total_paid,
        total_outstanding: acc.total_outstanding + patrol.total_outstanding,
      }),
      { total_scouts: 0, total_billed: 0, total_paid: 0, total_outstanding: 0 }
    )

    const result: DuesByPatrolData = {
      startDate,
      endDate,
      patrols,
      totals,
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Dues by patrol report error:', error)
    return NextResponse.json({ error: 'Failed to generate dues by patrol report' }, { status: 500 })
  }
}
