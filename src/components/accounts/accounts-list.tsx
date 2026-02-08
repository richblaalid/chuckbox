'use client'

import { useState, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { StatusFilterButtons, BalanceFilterButtons, type StatusFilter, type BalanceFilter } from '@/components/ui/filter-buttons'
import { SearchInput } from '@/components/ui/search-input'
import { SortIcon, type SortDirection } from '@/components/ui/sort-icon'
import { ResponsiveTable, MobileSubInfo } from '@/components/ui/responsive-table'
import { Button } from '@/components/ui/button'

interface ScoutAccount {
  id: string
  billing_balance: number | null
  funds_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: {
      name: string
    } | null
  } | null
}

interface AccountsListProps {
  accounts: ScoutAccount[]
  showPatrolFilter?: boolean
}

type SortColumn = 'name' | 'patrol' | 'status' | 'billing' | 'funds'

export function AccountsList({ accounts, showPatrolFilter = true }: AccountsListProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('billing')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatrols, setSelectedPatrols] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')

  // Extract unique patrols from accounts
  const patrols = useMemo(() => {
    const uniquePatrols = new Set<string>()
    accounts.forEach((a) => {
      if (a.scouts?.patrols?.name) uniquePatrols.add(a.scouts.patrols.name)
    })
    return Array.from(uniquePatrols).sort()
  }, [accounts])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const hasActiveFilters = selectedPatrols.size > 0 || statusFilter !== 'all' || balanceFilter !== 'all'

  const clearAllFilters = () => {
    setSelectedPatrols(new Set())
    setStatusFilter('all')
    setBalanceFilter('all')
    setSearchQuery('')
  }

  const filteredAndSortedAccounts = useMemo(() => {
    // Filter by search query
    const query = searchQuery.toLowerCase().trim()
    let filtered = query
      ? accounts.filter((account) => {
          if (!account.scouts) return false
          const fullName = `${account.scouts.first_name} ${account.scouts.last_name}`.toLowerCase()
          const reverseName = `${account.scouts.last_name} ${account.scouts.first_name}`.toLowerCase()
          return (
            fullName.includes(query) ||
            reverseName.includes(query) ||
            account.scouts.first_name.toLowerCase().includes(query) ||
            account.scouts.last_name.toLowerCase().includes(query)
          )
        })
      : accounts

    // Filter by patrol
    if (selectedPatrols.size > 0) {
      filtered = filtered.filter((account) => account.scouts?.patrols?.name && selectedPatrols.has(account.scouts.patrols.name))
    }

    // Filter by status
    if (statusFilter === 'active') {
      filtered = filtered.filter((account) => account.scouts?.is_active === true)
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((account) => account.scouts?.is_active === false)
    }

    // Filter by balance
    if (balanceFilter === 'owes') {
      filtered = filtered.filter((account) => (account.billing_balance || 0) < 0)
    } else if (balanceFilter === 'has_funds') {
      filtered = filtered.filter((account) => (account.funds_balance || 0) > 0)
    } else if (balanceFilter === 'settled') {
      filtered = filtered.filter((account) =>
        (account.billing_balance || 0) === 0 && (account.funds_balance || 0) === 0
      )
    }

    // Sort the filtered results
    return [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'name':
          const nameA = `${a.scouts?.last_name || ''} ${a.scouts?.first_name || ''}`
          const nameB = `${b.scouts?.last_name || ''} ${b.scouts?.first_name || ''}`
          comparison = nameA.localeCompare(nameB)
          break
        case 'patrol':
          comparison = (a.scouts?.patrols?.name || '').localeCompare(b.scouts?.patrols?.name || '')
          break
        case 'status':
          const statusA = a.scouts?.is_active ? 1 : 0
          const statusB = b.scouts?.is_active ? 1 : 0
          comparison = statusB - statusA
          break
        case 'billing':
          comparison = (a.billing_balance || 0) - (b.billing_balance || 0)
          break
        case 'funds':
          comparison = (a.funds_balance || 0) - (b.funds_balance || 0)
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [accounts, sortColumn, sortDirection, searchQuery, selectedPatrols, statusFilter, balanceFilter])

  if (accounts.length === 0) {
    return (
      <div className="py-12 text-center rounded-lg border border-dashed border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/30">
        <p className="text-stone-600 dark:text-stone-300">No scout accounts yet.</p>
      </div>
    )
  }

  const headerClass = "pb-3 pr-4 cursor-pointer select-none hover:text-stone-700 transition-colors"

  return (
    <div className="space-y-4">
      {/* Search and Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name..."
          ariaLabel="Search accounts by name"
        />

        {/* Patrol Filter Dropdown */}
        {showPatrolFilter && patrols.length > 0 && (
          <MultiSelectDropdown
            label="Patrol"
            options={patrols}
            selected={selectedPatrols}
            onChange={setSelectedPatrols}
          />
        )}

        {/* Status Filter */}
        <StatusFilterButtons value={statusFilter} onChange={setStatusFilter} />

        {/* Balance Filter */}
        <BalanceFilterButtons value={balanceFilter} onChange={setBalanceFilter} />

        {/* Clear All Filters */}
        {(hasActiveFilters || searchQuery) && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        )}
      </div>

      {/* Results count */}
      {(searchQuery || hasActiveFilters) && (
        <p className="text-sm text-stone-500">
          {filteredAndSortedAccounts.length === 0
            ? 'No accounts found'
            : `${filteredAndSortedAccounts.length} of ${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
        </p>
      )}

      {/* Table */}
      <ResponsiveTable>
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm font-medium text-stone-500">
              <th className={headerClass} onClick={() => handleSort('name')}>
                Scout
                <SortIcon direction={sortDirection} active={sortColumn === 'name'} />
              </th>
              <th className={`${headerClass} hidden sm:table-cell`} onClick={() => handleSort('patrol')}>
                Patrol
                <SortIcon direction={sortDirection} active={sortColumn === 'patrol'} />
              </th>
              <th className={`${headerClass} hidden md:table-cell`} onClick={() => handleSort('status')}>
                Status
                <SortIcon direction={sortDirection} active={sortColumn === 'status'} />
              </th>
              <th className={`${headerClass} text-right whitespace-nowrap`} onClick={() => handleSort('billing')}>
                Billing
                <SortIcon direction={sortDirection} active={sortColumn === 'billing'} />
              </th>
              <th className={`${headerClass} text-right whitespace-nowrap`} onClick={() => handleSort('funds')}>
                Funds
                <SortIcon direction={sortDirection} active={sortColumn === 'funds'} />
              </th>
              <th className="pb-3 pl-4 sm:pl-6 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-stone-500">
                  No accounts match your filters
                </td>
              </tr>
            ) : (
              filteredAndSortedAccounts.map((account) => {
                const billingBalance = account.billing_balance || 0
                const fundsBalance = account.funds_balance || 0
                return (
                  <tr key={account.id} className="border-b last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-stone-900">
                        {account.scouts?.first_name} {account.scouts?.last_name}
                      </p>
                      {/* Show patrol on mobile under name */}
                      {account.scouts?.patrols?.name && (
                        <MobileSubInfo>{account.scouts.patrols.name}</MobileSubInfo>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 text-stone-600 sm:table-cell">
                      {account.scouts?.patrols?.name || '—'}
                    </td>
                    <td className="hidden py-3 pr-4 md:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          account.scouts?.is_active
                            ? 'bg-success-light text-success'
                            : 'bg-stone-100 text-stone-600'
                        }`}
                      >
                        {account.scouts?.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 pr-2 text-right whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          billingBalance < 0 ? 'text-error' : 'text-stone-900'
                        }`}
                      >
                        {billingBalance < 0
                          ? formatCurrency(Math.abs(billingBalance))
                          : '$0.00'}
                      </span>
                    </td>
                    <td className="py-3 pr-2 text-right whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          fundsBalance > 0 ? 'text-success' : 'text-stone-900'
                        }`}
                      >
                        {fundsBalance > 0 ? formatCurrency(fundsBalance) : '$0.00'}
                      </span>
                    </td>
                    <td className="py-3 pl-4 sm:pl-6 whitespace-nowrap">
                      <Link
                        href={`/finances/accounts/${account.id}`}
                        className="text-sm text-forest-600 hover:text-forest-800 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}
