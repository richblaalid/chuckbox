import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage } from '@/lib/roles'

interface AccountBalance {
  account_id: string
  account_name: string
  account_code: string
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  balance: number
}

interface BalanceSheetData {
  asOfDate: string
  assets: AccountBalance[]
  liabilities: AccountBalance[]
  equity: AccountBalance[]
  totals: {
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    netIncome: number // Retained earnings from income - expenses
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
    const asOfDateParam = searchParams.get('asOfDate')

    // Default to today if no date provided
    const asOfDate = asOfDateParam || new Date().toISOString().split('T')[0]

    // Get all accounts for this unit
    const { data: accountsData, error: accountsError } = await supabase
      .from('accounts')
      .select('id, name, code, account_type')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .order('code')

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError)
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    // Get journal entries with their lines for the unit up to asOfDate
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
      .lte('entry_date', asOfDate)
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
      // Debits increase assets/expenses, decrease liabilities/equity/income
      // Credits decrease assets/expenses, increase liabilities/equity/income
      balancesByAccount[line.account_id] += (line.debit || 0) - (line.credit || 0)
    }

    // Group accounts by type
    const assets: AccountBalance[] = []
    const liabilities: AccountBalance[] = []
    const equity: AccountBalance[] = []
    let incomeTotal = 0
    let expenseTotal = 0

    for (const account of accountsData || []) {
      const rawBalance = balancesByAccount[account.id] || 0

      // For balance sheet accounts, determine display balance
      // Assets: positive = debit balance (normal)
      // Liabilities/Equity: negative raw balance = credit balance (normal), so negate for display
      if (account.account_type === 'asset') {
        assets.push({
          account_id: account.id,
          account_name: account.name,
          account_code: account.code,
          account_type: account.account_type,
          balance: rawBalance, // Assets show debit balance as positive
        })
      } else if (account.account_type === 'liability') {
        liabilities.push({
          account_id: account.id,
          account_name: account.name,
          account_code: account.code,
          account_type: account.account_type,
          balance: -rawBalance, // Liabilities: credit balance shown as positive
        })
      } else if (account.account_type === 'equity') {
        equity.push({
          account_id: account.id,
          account_name: account.name,
          account_code: account.code,
          account_type: account.account_type,
          balance: -rawBalance, // Equity: credit balance shown as positive
        })
      } else if (account.account_type === 'income') {
        // Income accounts have credit balance (negative raw)
        incomeTotal += -rawBalance
      } else if (account.account_type === 'expense') {
        // Expense accounts have debit balance (positive raw)
        expenseTotal += rawBalance
      }
    }

    // Calculate net income (revenue - expenses)
    const netIncome = incomeTotal - expenseTotal

    // Calculate totals
    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0)
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0)
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0)

    const result: BalanceSheetData = {
      asOfDate,
      assets: assets.filter(a => a.balance !== 0),
      liabilities: liabilities.filter(a => a.balance !== 0),
      equity: equity.filter(a => a.balance !== 0),
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        netIncome,
      },
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Balance sheet report error:', error)
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 })
  }
}
