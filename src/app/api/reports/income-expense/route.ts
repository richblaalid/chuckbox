import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { canAccessPage } from '@/lib/roles'

interface AccountBalance {
  account_id: string
  account_name: string
  account_code: string
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  balance: number
}

interface IncomeExpenseData {
  startDate: string
  endDate: string
  income: AccountBalance[]
  expenses: AccountBalance[]
  totals: {
    totalIncome: number
    totalExpenses: number
    netIncome: number
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

    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
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

    // Default to current fiscal year (Jan 1 to today) if no dates provided
    const today = new Date()
    const defaultStartDate = `${today.getFullYear()}-01-01`
    const defaultEndDate = today.toISOString().split('T')[0]

    const startDate = startDateParam || defaultStartDate
    const endDate = endDateParam || defaultEndDate

    // Get all accounts for this unit
    const { data: accountsData, error: accountsError } = await supabase
      .from('accounts')
      .select('id, name, code, account_type')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .in('account_type', ['income', 'expense'])
      .order('code')

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError)
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    // Get journal entries with their lines for the date range
    // Query through journal_entries first to use unit_id RLS policies
    const { data: entriesData, error: entriesError } = await supabase
      .from('journal_entries')
      .select(`
        id,
        journal_lines (
          account_id,
          debit,
          credit
        )
      `)
      .eq('unit_id', membership.unit_id)
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .eq('is_posted', true)
      .or('is_void.is.null,is_void.eq.false')

    if (entriesError) {
      console.error('Error fetching journal entries:', entriesError)
      return NextResponse.json({ error: 'Failed to fetch journal data' }, { status: 500 })
    }

    // Flatten journal lines from all entries
    interface JournalLineRow {
      account_id: string
      debit: number | null
      credit: number | null
    }

    interface JournalEntryRow {
      id: string
      journal_lines: JournalLineRow[]
    }

    const unitLines: JournalLineRow[] = []
    for (const entry of (entriesData as JournalEntryRow[]) || []) {
      for (const line of entry.journal_lines || []) {
        unitLines.push(line)
      }
    }

    // Calculate balances by account
    const balancesByAccount: Record<string, number> = {}
    for (const line of unitLines) {
      if (!balancesByAccount[line.account_id]) {
        balancesByAccount[line.account_id] = 0
      }
      // Debits increase expenses, decrease income
      // Credits increase income, decrease expenses
      balancesByAccount[line.account_id] += (line.debit || 0) - (line.credit || 0)
    }

    // Separate income and expenses
    const income: AccountBalance[] = []
    const expenses: AccountBalance[] = []

    for (const account of accountsData || []) {
      const rawBalance = balancesByAccount[account.id] || 0

      if (account.account_type === 'income') {
        // Income has credit balance (negative raw), show as positive
        income.push({
          account_id: account.id,
          account_name: account.name,
          account_code: account.code,
          account_type: account.account_type,
          balance: -rawBalance,
        })
      } else if (account.account_type === 'expense') {
        // Expenses have debit balance (positive raw)
        expenses.push({
          account_id: account.id,
          account_name: account.name,
          account_code: account.code,
          account_type: account.account_type,
          balance: rawBalance,
        })
      }
    }

    // Calculate totals
    const totalIncome = income.reduce((sum, a) => sum + a.balance, 0)
    const totalExpenses = expenses.reduce((sum, a) => sum + a.balance, 0)
    const netIncome = totalIncome - totalExpenses

    const result: IncomeExpenseData = {
      startDate,
      endDate,
      income: income.filter(a => a.balance !== 0),
      expenses: expenses.filter(a => a.balance !== 0),
      totals: {
        totalIncome,
        totalExpenses,
        netIncome,
      },
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Income/expense report error:', error)
    return NextResponse.json({ error: 'Failed to generate income/expense report' }, { status: 500 })
  }
}
