'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ResponsiveTable, tableStyles } from '@/components/ui/responsive-table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchInput } from '@/components/ui/search-input'
import { ToggleButtonGroup, type ToggleOption } from '@/components/ui/toggle-button-group'
import { SortIcon, type SortDirection } from '@/components/ui/sort-icon'
import { formatCurrency, cn } from '@/lib/utils'
import { CreditCard, Receipt, Bell } from 'lucide-react'

export interface ScoutAccountRow {
  id: string
  scoutId: string
  scoutName: string
  patrolName: string | null
  billingBalance: number
  fundsBalance: number
  lastActivity: string | null
  isActive: boolean
  daysOverdue?: number
}

type BalanceFilter = 'all' | 'owes' | 'overdue' | 'has-funds' | 'zero'

const BALANCE_OPTIONS: ToggleOption<BalanceFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'owes', label: 'Owes Money' },
  { value: 'overdue', label: 'Overdue (30+)' },
  { value: 'has-funds', label: 'Has Funds' },
  { value: 'zero', label: 'Zero Balance' },
]

type SortColumn = 'name' | 'patrol' | 'amountOwed' | 'fundsBalance' | 'lastActivity'

interface UnifiedScoutAccountsTableProps {
  scouts: ScoutAccountRow[]
  patrols: string[]
  selectedIds: string[]
  onScoutSelect: (scout: ScoutAccountRow) => void
  onSelectionChange: (ids: string[]) => void
  onRecordPayment?: (scout: ScoutAccountRow) => void
  onCreateBilling?: (scout: ScoutAccountRow) => void
  onSendReminder?: (scout: ScoutAccountRow) => void
}

export function UnifiedScoutAccountsTable({
  scouts,
  patrols,
  selectedIds,
  onScoutSelect,
  onSelectionChange,
  onRecordPayment,
  onCreateBilling,
  onSendReminder,
}: UnifiedScoutAccountsTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [patrolFilter, setPatrolFilter] = useState<string>('all')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getAriaSort = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sortColumn !== column) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  const filteredScouts = useMemo(() => {
    let filtered = scouts.filter((scout) => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        if (!scout.scoutName.toLowerCase().includes(search)) {
          return false
        }
      }

      // Patrol filter
      if (patrolFilter !== 'all' && scout.patrolName !== patrolFilter) {
        return false
      }

      // Balance filter
      if (balanceFilter === 'owes' && scout.billingBalance >= 0) {
        return false
      }
      if (balanceFilter === 'overdue') {
        // Filter for scouts with charges 30+ days old
        if (!scout.daysOverdue || scout.daysOverdue < 30) {
          return false
        }
      }
      if (balanceFilter === 'has-funds' && scout.fundsBalance <= 0) {
        return false
      }
      if (balanceFilter === 'zero' && (scout.billingBalance !== 0 || scout.fundsBalance !== 0)) {
        return false
      }

      return true
    })

    // Sort
    return [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'name':
          comparison = a.scoutName.localeCompare(b.scoutName)
          break
        case 'patrol':
          comparison = (a.patrolName || '').localeCompare(b.patrolName || '')
          break
        case 'amountOwed':
          comparison = a.billingBalance - b.billingBalance
          break
        case 'fundsBalance':
          comparison = a.fundsBalance - b.fundsBalance
          break
        case 'lastActivity':
          // Sort nulls last
          if (!a.lastActivity && !b.lastActivity) comparison = 0
          else if (!a.lastActivity) comparison = 1
          else if (!b.lastActivity) comparison = -1
          else comparison = a.lastActivity.localeCompare(b.lastActivity)
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [scouts, searchTerm, patrolFilter, balanceFilter, sortColumn, sortDirection])

  const allSelected = filteredScouts.length > 0 && filteredScouts.every((s) => selectedIds.includes(s.id))
  const someSelected = filteredScouts.some((s) => selectedIds.includes(s.id))

  const hasActiveFilters = patrolFilter !== 'all' || balanceFilter !== 'all'

  const clearAllFilters = () => {
    setSearchTerm('')
    setPatrolFilter('all')
    setBalanceFilter('all')
  }

  const handleSelectAll = () => {
    if (allSelected) {
      onSelectionChange([])
    } else {
      onSelectionChange(filteredScouts.map((s) => s.id))
    }
  }

  const handleSelectOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id))
    } else {
      onSelectionChange([...selectedIds, id])
    }
  }

  const handleRowClick = (scout: ScoutAccountRow, e: React.MouseEvent) => {
    // Don't trigger row click if clicking checkbox or action buttons
    if ((e.target as HTMLElement).closest('[role="checkbox"]') ||
        (e.target as HTMLElement).closest('[data-action-button]')) {
      return
    }
    onScoutSelect(scout)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search scouts..."
            ariaLabel="Search scouts by name"
            className="w-64"
          />

          <Select value={patrolFilter} onValueChange={setPatrolFilter}>
            <SelectTrigger className={cn(
              "w-[150px] border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-800",
              patrolFilter !== 'all' && "border-forest-300 bg-forest-50 text-forest-700 dark:border-forest-600 dark:bg-forest-950 dark:text-forest-400"
            )}>
              <SelectValue placeholder="All Patrols" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Patrols</SelectItem>
              {patrols.map((patrol) => (
                <SelectItem key={patrol} value={patrol}>
                  {patrol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ToggleButtonGroup
            options={BALANCE_OPTIONS}
            value={balanceFilter}
            onChange={setBalanceFilter}
            size="sm"
            aria-label="Balance filter"
          />

          {(hasActiveFilters || searchTerm) && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Results count */}
      {(searchTerm || hasActiveFilters) && (
        <p className="text-sm text-stone-500">
          {filteredScouts.length === 0
            ? 'No scouts found'
            : `Showing ${filteredScouts.length} of ${scouts.length} scout${scouts.length !== 1 ? 's' : ''}`}
        </p>
      )}

      {/* Table */}
      <ResponsiveTable className="border rounded-lg bg-white dark:bg-stone-900">
        <table className={tableStyles.table}>
          <thead className={tableStyles.thead}>
            <tr className="bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700">
              <th className="w-[50px] py-3 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="py-3 pr-4" aria-sort={getAriaSort('name')}>
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="inline-flex items-center gap-1 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
                >
                  Scout Name
                  <SortIcon direction={sortDirection} active={sortColumn === 'name'} />
                </button>
              </th>
              <th className={cn("py-3 pr-4", tableStyles.hiddenSm)} aria-sort={getAriaSort('patrol')}>
                <button
                  type="button"
                  onClick={() => handleSort('patrol')}
                  className="inline-flex items-center gap-1 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
                >
                  Patrol
                  <SortIcon direction={sortDirection} active={sortColumn === 'patrol'} />
                </button>
              </th>
              <th className={cn("py-3 pr-4", tableStyles.textRight)} aria-sort={getAriaSort('amountOwed')}>
                <button
                  type="button"
                  onClick={() => handleSort('amountOwed')}
                  className="inline-flex items-center gap-1 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors justify-end w-full"
                >
                  Amount Owed
                  <SortIcon direction={sortDirection} active={sortColumn === 'amountOwed'} />
                </button>
              </th>
              <th className={cn("py-3 pr-4", tableStyles.textRight, tableStyles.hiddenMd)} aria-sort={getAriaSort('fundsBalance')}>
                <button
                  type="button"
                  onClick={() => handleSort('fundsBalance')}
                  className="inline-flex items-center gap-1 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors justify-end w-full"
                >
                  Funds Balance
                  <SortIcon direction={sortDirection} active={sortColumn === 'fundsBalance'} />
                </button>
              </th>
              <th className={cn("py-3 pr-4", tableStyles.hiddenLg)} aria-sort={getAriaSort('lastActivity')}>
                <button
                  type="button"
                  onClick={() => handleSort('lastActivity')}
                  className="inline-flex items-center gap-1 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
                >
                  Last Activity
                  <SortIcon direction={sortDirection} active={sortColumn === 'lastActivity'} />
                </button>
              </th>
              <th className="py-3 pr-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={tableStyles.tbody}>
            {filteredScouts.map((scout) => (
              <tr
                key={scout.id}
                className={cn(tableStyles.tr, 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50')}
                onClick={(e) => handleRowClick(scout, e)}
              >
                <td className="py-3 pl-4">
                  <Checkbox
                    checked={selectedIds.includes(scout.id)}
                    onCheckedChange={() => handleSelectOne(scout.id)}
                    aria-label={`Select ${scout.scoutName}`}
                  />
                </td>
                <td className={cn(tableStyles.td, 'font-medium')}>{scout.scoutName}</td>
                <td className={cn(tableStyles.td, tableStyles.hiddenSm)}>{scout.patrolName || '—'}</td>
                <td
                  className={cn(
                    tableStyles.td,
                    tableStyles.textRight,
                    scout.billingBalance < 0 && 'text-error font-medium'
                  )}
                >
                  {formatCurrency(scout.billingBalance)}
                </td>
                <td className={cn(tableStyles.td, tableStyles.textRight, tableStyles.hiddenMd)}>
                  {formatCurrency(scout.fundsBalance)}
                </td>
                <td className={cn(tableStyles.td, tableStyles.hiddenLg, 'text-muted-foreground')}>
                  {scout.lastActivity
                    ? new Date(scout.lastActivity).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </td>
                <td className={cn(tableStyles.td, 'text-right pr-4')}>
                  <div className="flex items-center justify-end gap-1">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            data-action-button
                            onClick={() => onRecordPayment?.(scout)}
                            disabled={scout.billingBalance >= 0}
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md",
                              scout.billingBalance >= 0
                                ? "text-stone-300 cursor-not-allowed dark:text-stone-600"
                                : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-500 dark:hover:bg-emerald-950 dark:hover:text-emerald-400"
                            )}
                            aria-label={`Record payment for ${scout.scoutName}`}
                          >
                            <CreditCard className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {scout.billingBalance >= 0 ? "No balance owed" : "Record Payment"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            data-action-button
                            onClick={() => onCreateBilling?.(scout)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-500 dark:hover:bg-amber-950 dark:hover:text-amber-400"
                            aria-label={`Create billing for ${scout.scoutName}`}
                          >
                            <Receipt className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Create Billing</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            data-action-button
                            onClick={() => onSendReminder?.(scout)}
                            disabled={scout.billingBalance >= 0}
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md",
                              scout.billingBalance >= 0
                                ? "text-stone-300 cursor-not-allowed dark:text-stone-600"
                                : "text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-500 dark:hover:bg-blue-950 dark:hover:text-blue-400"
                            )}
                            aria-label={`Send reminder for ${scout.scoutName}`}
                          >
                            <Bell className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {scout.billingBalance >= 0 ? "No balance owed" : "Send Reminder"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </td>
              </tr>
            ))}
            {filteredScouts.length === 0 && (
              <tr>
                <td colSpan={7} className="h-24 text-center text-muted-foreground">
                  No scouts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}
