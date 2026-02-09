import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AccessDenied } from '@/components/ui/access-denied'
import { canAccessPage } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { TransactionList } from '@/components/reports/transaction-list'
import { Database } from '@/types/database'

type JournalEntryType = Database['public']['Enums']['journal_entry_type']

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    startDate?: string
    endDate?: string
    type?: string
    scoutId?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return null

  // Get user's unit membership
  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  interface Membership {
    unit_id: string
    role: string
    units: { name: string } | null
  }

  const membership = membershipData as Membership | null

  if (!membership) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h1 className="text-2xl font-bold text-stone-900">No Unit Access</h1>
        <p className="mt-2 text-stone-600">
          You are not currently a member of any unit.
        </p>
      </div>
    )
  }

  // Check role-based access
  if (!canAccessPage(membership.role, 'reports')) {
    return <AccessDenied message="Only administrators, treasurers, and leaders can view transactions." />
  }

  // Parse filter parameters
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const startDate = params.startDate || thirtyDaysAgo.toISOString().split('T')[0]
  const endDate = params.endDate || today.toISOString().split('T')[0]
  const entryType = params.type || ''
  const scoutId = params.scoutId || ''
  const page = parseInt(params.page || '1', 10)
  const pageSize = 50

  // Build query for journal entries
  let query = supabase
    .from('journal_entries')
    .select(`
      id,
      entry_date,
      description,
      entry_type,
      is_posted,
      is_void,
      created_at,
      journal_lines (
        id,
        debit,
        credit,
        memo,
        scout_account_id,
        accounts (
          name,
          code
        ),
        scout_accounts (
          scouts (
            first_name,
            last_name
          )
        )
      )
    `, { count: 'exact' })
    .eq('unit_id', membership.unit_id)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  // Apply entry type filter
  if (entryType) {
    query = query.eq('entry_type', entryType as JournalEntryType)
  }

  const { data: entriesData, count: totalCount, error: entriesError } = await query

  if (entriesError) {
    console.error('Error fetching transactions:', entriesError)
  }

  interface JournalLineRow {
    id: string
    debit: number | null
    credit: number | null
    memo: string | null
    scout_account_id: string | null
    accounts: { name: string; code: string } | null
    scout_accounts: { scouts: { first_name: string; last_name: string } | null } | null
  }

  interface JournalEntryRow {
    id: string
    entry_date: string
    description: string
    entry_type: string | null
    is_posted: boolean | null
    is_void: boolean | null
    created_at: string
    journal_lines: JournalLineRow[]
  }

  // Filter by scout if specified
  let entries = (entriesData as JournalEntryRow[]) || []
  if (scoutId) {
    entries = entries.filter(entry =>
      entry.journal_lines.some(line => line.scout_account_id === scoutId)
    )
  }

  // Get unique entry types for filter dropdown
  const { data: entryTypesData } = await supabase
    .from('journal_entries')
    .select('entry_type')
    .eq('unit_id', membership.unit_id)
    .not('entry_type', 'is', null)

  const entryTypes = [...new Set((entryTypesData || []).map(e => e.entry_type).filter(Boolean))]

  // Get scouts for filter dropdown
  const { data: scoutsData } = await supabase
    .from('scouts')
    .select('id, first_name, last_name')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')

  interface Scout {
    id: string
    first_name: string
    last_name: string
  }

  const scouts = (scoutsData as Scout[]) || []

  const totalPages = Math.ceil((totalCount || 0) / pageSize)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Transaction History</h1>
        <p className="mt-1 text-stone-600">
          All financial transactions for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav showFinancialTabs={true} />

      <Card>
        <CardHeader>
          <CardTitle>Journal Entries</CardTitle>
          <CardDescription>
            {totalCount || 0} transactions found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionList
            entries={entries}
            startDate={startDate}
            endDate={endDate}
            entryType={entryType}
            scoutId={scoutId}
            entryTypes={entryTypes as string[]}
            scouts={scouts}
            currentPage={page}
            totalPages={totalPages}
            totalCount={totalCount || 0}
          />
        </CardContent>
      </Card>
    </div>
  )
}
