'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { ScoutForm } from './scout-form'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { StatusFilterButtons, type StatusFilter } from '@/components/ui/filter-buttons'
import { SearchInput } from '@/components/ui/search-input'
import { SortIcon, type SortDirection } from '@/components/ui/sort-icon'
import { ResponsiveTable, MobileSubInfo } from '@/components/ui/responsive-table'
import { Button } from '@/components/ui/button'

interface Scout {
  id: string
  first_name: string
  last_name: string
  patrol_id: string | null
  rank: string | null
  is_active: boolean | null
  date_of_birth: string | null
  bsa_member_id: string | null
  current_position: string | null
  current_position_2: string | null
  scout_accounts: { id: string; billing_balance: number | null } | null
  patrols: { name: string } | null
}

interface ScoutsListProps {
  scouts: Scout[]
  canManage: boolean
  unitId: string
}

type SortColumn = 'name' | 'patrol' | 'rank' | 'position' | 'status' | 'billing'

export function ScoutsList({ scouts, canManage, unitId }: ScoutsListProps) {
  const router = useRouter()
  const [editingScout, setEditingScout] = useState<Scout | null>(null)
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatrols, setSelectedPatrols] = useState<Set<string>>(new Set())
  const [selectedRanks, setSelectedRanks] = useState<Set<string>>(new Set())
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Extract unique patrols and ranks from scouts
  const patrols = useMemo(() => {
    const uniquePatrols = new Set<string>()
    scouts.forEach((s) => {
      if (s.patrols?.name) uniquePatrols.add(s.patrols?.name)
    })
    return Array.from(uniquePatrols).sort()
  }, [scouts])

  const ranks = useMemo(() => {
    const uniqueRanks = new Set<string>()
    scouts.forEach((s) => {
      if (s.rank) uniqueRanks.add(s.rank)
    })
    return Array.from(uniqueRanks).sort()
  }, [scouts])

  const positions = useMemo(() => {
    const uniquePositions = new Set<string>()
    scouts.forEach((s) => {
      if (s.current_position) uniquePositions.add(s.current_position)
      if (s.current_position_2) uniquePositions.add(s.current_position_2)
    })
    return Array.from(uniquePositions).sort()
  }, [scouts])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const hasActiveFilters = selectedPatrols.size > 0 || selectedRanks.size > 0 || selectedPositions.size > 0 || statusFilter !== 'all'

  const clearAllFilters = () => {
    setSelectedPatrols(new Set())
    setSelectedRanks(new Set())
    setSelectedPositions(new Set())
    setStatusFilter('all')
    setSearchQuery('')
  }

  const filteredAndSortedScouts = useMemo(() => {
    // Filter by search query
    const query = searchQuery.toLowerCase().trim()
    let filtered = query
      ? scouts.filter((scout) => {
          const fullName = `${scout.first_name} ${scout.last_name}`.toLowerCase()
          const reverseName = `${scout.last_name} ${scout.first_name}`.toLowerCase()
          return (
            fullName.includes(query) ||
            reverseName.includes(query) ||
            scout.first_name.toLowerCase().includes(query) ||
            scout.last_name.toLowerCase().includes(query)
          )
        })
      : scouts

    // Filter by patrol
    if (selectedPatrols.size > 0) {
      filtered = filtered.filter((scout) => scout.patrols?.name && selectedPatrols.has(scout.patrols?.name))
    }

    // Filter by rank
    if (selectedRanks.size > 0) {
      filtered = filtered.filter((scout) => scout.rank && selectedRanks.has(scout.rank))
    }

    // Filter by position (matches if either position matches)
    if (selectedPositions.size > 0) {
      filtered = filtered.filter((scout) =>
        (scout.current_position && selectedPositions.has(scout.current_position)) ||
        (scout.current_position_2 && selectedPositions.has(scout.current_position_2))
      )
    }

    // Filter by status
    if (statusFilter === 'active') {
      filtered = filtered.filter((scout) => scout.is_active === true)
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((scout) => scout.is_active === false)
    }

    // Sort the filtered results
    return [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'name':
          comparison = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
          break
        case 'patrol':
          comparison = (a.patrols?.name || '').localeCompare(b.patrols?.name || '')
          break
        case 'rank':
          comparison = (a.rank || '').localeCompare(b.rank || '')
          break
        case 'position':
          comparison = (a.current_position || '').localeCompare(b.current_position || '')
          break
        case 'status':
          comparison = (a.is_active === b.is_active) ? 0 : a.is_active ? -1 : 1
          break
        case 'billing':
          const balanceA = a.scout_accounts?.billing_balance ?? 0
          const balanceB = b.scout_accounts?.billing_balance ?? 0
          comparison = balanceA - balanceB
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [scouts, sortColumn, sortDirection, searchQuery, selectedPatrols, selectedRanks, selectedPositions, statusFilter])

  if (scouts.length === 0) {
    return (
      <div className="py-12 text-center rounded-lg border border-dashed border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/30">
        <p className="text-stone-600 dark:text-stone-300">No scouts in your unit yet.</p>
        {canManage && (
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            Click &quot;Add Scout&quot; to add your first scout.
          </p>
        )}
      </div>
    )
  }

  const headerClass = "pb-3 pr-4"
  const headerButtonClass = "inline-flex items-center gap-1 cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors text-left font-medium"

  const getAriaSort = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sortColumn !== column) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name..."
          ariaLabel="Search scouts by name"
        />

        {/* Filter Dropdowns */}
        <MultiSelectDropdown
          label="Patrol"
          options={patrols}
          selected={selectedPatrols}
          onChange={setSelectedPatrols}
        />

        <MultiSelectDropdown
          label="Rank"
          options={ranks}
          selected={selectedRanks}
          onChange={setSelectedRanks}
        />

        <MultiSelectDropdown
          label="Position"
          options={positions}
          selected={selectedPositions}
          onChange={setSelectedPositions}
        />

        {/* Status Filter */}
        <StatusFilterButtons value={statusFilter} onChange={setStatusFilter} />

        {/* Clear All Filters */}
        {(hasActiveFilters || searchQuery) && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        )}
      </div>

      {/* Results count */}
      {(searchQuery || hasActiveFilters) && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {filteredAndSortedScouts.length === 0
            ? 'No scouts found'
            : `${filteredAndSortedScouts.length} of ${scouts.length} scout${scouts.length !== 1 ? 's' : ''}`}
        </p>
      )}

      {/* Table */}
      <ResponsiveTable>
        <table className="w-full">
        <thead>
          <tr className="border-b border-stone-200 dark:border-stone-700 text-left text-sm text-stone-500 dark:text-stone-400">
            <th className={headerClass} aria-sort={getAriaSort('name')}>
              <button type="button" onClick={() => handleSort('name')} className={headerButtonClass}>
                Name
                <SortIcon direction={sortDirection} active={sortColumn === 'name'} />
              </button>
            </th>
            <th className={`${headerClass} hidden sm:table-cell`} aria-sort={getAriaSort('patrol')}>
              <button type="button" onClick={() => handleSort('patrol')} className={headerButtonClass}>
                Patrol
                <SortIcon direction={sortDirection} active={sortColumn === 'patrol'} />
              </button>
            </th>
            <th className={`${headerClass} hidden md:table-cell`} aria-sort={getAriaSort('rank')}>
              <button type="button" onClick={() => handleSort('rank')} className={headerButtonClass}>
                Rank
                <SortIcon direction={sortDirection} active={sortColumn === 'rank'} />
              </button>
            </th>
            <th className={`${headerClass} hidden lg:table-cell`} aria-sort={getAriaSort('position')}>
              <button type="button" onClick={() => handleSort('position')} className={headerButtonClass}>
                Position
                <SortIcon direction={sortDirection} active={sortColumn === 'position'} />
              </button>
            </th>
            <th className={`${headerClass} hidden xl:table-cell`} aria-sort={getAriaSort('status')}>
              <button type="button" onClick={() => handleSort('status')} className={headerButtonClass}>
                Status
                <SortIcon direction={sortDirection} active={sortColumn === 'status'} />
              </button>
            </th>
            <th className={`${headerClass} text-right whitespace-nowrap`} aria-sort={getAriaSort('billing')}>
              <button type="button" onClick={() => handleSort('billing')} className={`${headerButtonClass} justify-end w-full`}>
                Billing
                <SortIcon direction={sortDirection} active={sortColumn === 'billing'} />
              </button>
            </th>
            {canManage && <th className="pb-3 pl-4 sm:pl-6 font-medium whitespace-nowrap">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {filteredAndSortedScouts.length === 0 ? (
            <tr>
              <td colSpan={canManage ? 7 : 6} className="py-8 text-center text-stone-500 dark:text-stone-400">
                No scouts match your filters
              </td>
            </tr>
          ) : (
            filteredAndSortedScouts.map((scout) => {
            const balance = scout.scout_accounts?.billing_balance ?? 0
            const accountId = scout.scout_accounts?.id

            return (
              <tr key={scout.id} className="border-b border-stone-200 dark:border-stone-700 last:border-0">
                <td className="py-3 pr-4">
                  <div>
                    <Link
                      href={`/scouts/${scout.id}`}
                      className="font-medium text-stone-900 hover:text-forest-600 dark:text-stone-100 dark:hover:text-forest-400"
                    >
                      {scout.first_name} {scout.last_name}
                    </Link>
                    {scout.bsa_member_id && (
                      <p className="text-xs text-stone-500 dark:text-stone-400">BSA# {scout.bsa_member_id}</p>
                    )}
                    {/* Show patrol on mobile under name */}
                    {scout.patrols?.name && (
                      <MobileSubInfo>{scout.patrols.name}</MobileSubInfo>
                    )}
                  </div>
                </td>
                <td className="hidden py-3 pr-4 text-stone-600 dark:text-stone-300 sm:table-cell">{scout.patrols?.name || '—'}</td>
                <td className="hidden py-3 pr-4 text-stone-600 dark:text-stone-300 md:table-cell">{scout.rank || '—'}</td>
                <td className="hidden py-3 pr-4 text-stone-600 dark:text-stone-300 lg:table-cell">
                  {scout.current_position ? (
                    <div>
                      <span>{scout.current_position}</span>
                      {scout.current_position_2 && (
                        <span className="block text-xs text-stone-500 dark:text-stone-400">{scout.current_position_2}</span>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td className="hidden py-3 pr-4 xl:table-cell">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      scout.is_active
                        ? 'bg-success-light text-success'
                        : 'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
                    }`}
                  >
                    {scout.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="py-3 pr-2 text-right whitespace-nowrap">
                  <span
                    className={`font-medium ${
                      balance < 0 ? 'text-error' : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    {balance < 0 ? formatCurrency(Math.abs(balance)) : '$0.00'}
                  </span>
                </td>
                {canManage && (
                  <td className="py-3 pl-4 sm:pl-6 whitespace-nowrap">
                    <div className="flex gap-3">
                      <Link
                        href={`/scouts/${scout.id}`}
                        className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                      >
                        View
                      </Link>
                      <button
                        onClick={() => setEditingScout(scout)}
                        className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                      >
                        Edit
                      </button>
                      {accountId && (
                        <Link
                          href={`/finances/accounts/${accountId}`}
                          className="text-sm text-forest-600 hover:text-forest-800 hidden sm:inline rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                        >
                          Account
                        </Link>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            )
          })
          )}
        </tbody>
      </table>
      </ResponsiveTable>

      {editingScout && (
        <ScoutForm
          unitId={unitId}
          scout={{
            id: editingScout.id,
            first_name: editingScout.first_name,
            last_name: editingScout.last_name,
            patrol_id: editingScout.patrol_id,
            rank: editingScout.rank,
            date_of_birth: editingScout.date_of_birth,
            bsa_member_id: editingScout.bsa_member_id,
            is_active: editingScout.is_active,
          }}
          onClose={() => setEditingScout(null)}
          onSuccess={() => {
            setEditingScout(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
