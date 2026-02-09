'use client'

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ResponsiveTable, tableStyles } from '@/components/ui/responsive-table'
import { formatCurrency, cn } from '@/lib/utils'
import { Search } from 'lucide-react'

export interface ScoutAccountRow {
  id: string
  scoutId: string
  scoutName: string
  patrolName: string | null
  billingBalance: number
  fundsBalance: number
  lastActivity: string | null
  isActive: boolean
}

type BalanceFilter = 'all' | 'owes' | 'has-funds' | 'zero'

interface UnifiedScoutAccountsTableProps {
  scouts: ScoutAccountRow[]
  patrols: string[]
  selectedIds: string[]
  onScoutSelect: (scout: ScoutAccountRow) => void
  onSelectionChange: (ids: string[]) => void
}

export function UnifiedScoutAccountsTable({
  scouts,
  patrols,
  selectedIds,
  onScoutSelect,
  onSelectionChange,
}: UnifiedScoutAccountsTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [patrolFilter, setPatrolFilter] = useState<string>('all')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')

  const filteredScouts = useMemo(() => {
    return scouts.filter((scout) => {
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
      if (balanceFilter === 'has-funds' && scout.fundsBalance <= 0) {
        return false
      }
      if (balanceFilter === 'zero' && (scout.billingBalance !== 0 || scout.fundsBalance !== 0)) {
        return false
      }

      return true
    })
  }, [scouts, searchTerm, patrolFilter, balanceFilter])

  const allSelected = filteredScouts.length > 0 && filteredScouts.every((s) => selectedIds.includes(s.id))
  const someSelected = filteredScouts.some((s) => selectedIds.includes(s.id))

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
    // Don't trigger row click if clicking checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return
    }
    onScoutSelect(scout)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search scouts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={patrolFilter} onValueChange={setPatrolFilter}>
          <SelectTrigger className="w-[150px]">
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

        <div className="flex gap-1">
          <Button
            variant={balanceFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('all')}
          >
            All
          </Button>
          <Button
            variant={balanceFilter === 'owes' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('owes')}
          >
            Owes Money
          </Button>
          <Button
            variant={balanceFilter === 'has-funds' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('has-funds')}
          >
            Has Funds
          </Button>
          <Button
            variant={balanceFilter === 'zero' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('zero')}
          >
            Zero Balance
          </Button>
        </div>
      </div>

      {/* Table */}
      <ResponsiveTable className="border rounded-lg">
        <table className={tableStyles.table}>
          <thead className={tableStyles.thead}>
            <tr>
              <th className="w-[50px] pb-3 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className={tableStyles.th}>Scout Name</th>
              <th className={cn(tableStyles.th, tableStyles.hiddenSm)}>Patrol</th>
              <th className={cn(tableStyles.th, tableStyles.textRight)}>Amount Owed</th>
              <th className={cn(tableStyles.th, tableStyles.textRight, tableStyles.hiddenMd)}>Funds Balance</th>
              <th className={cn(tableStyles.th, tableStyles.hiddenLg)}>Last Activity</th>
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
              </tr>
            ))}
            {filteredScouts.length === 0 && (
              <tr>
                <td colSpan={6} className="h-24 text-center text-muted-foreground">
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
