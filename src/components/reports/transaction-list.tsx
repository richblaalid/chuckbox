'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { formatCurrency, cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Filter, X } from 'lucide-react'

interface JournalLine {
  id: string
  debit: number | null
  credit: number | null
  memo: string | null
  scout_account_id: string | null
  accounts: { name: string; code: string } | null
  scout_accounts: { scouts: { first_name: string; last_name: string } | null } | null
}

interface JournalEntry {
  id: string
  entry_date: string
  description: string
  entry_type: string | null
  is_posted: boolean | null
  is_void: boolean | null
  created_at: string
  journal_lines: JournalLine[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
}

interface TransactionListProps {
  entries: JournalEntry[]
  startDate: string
  endDate: string
  entryType: string
  scoutId: string
  entryTypes: string[]
  scouts: Scout[]
  currentPage: number
  totalPages: number
  totalCount: number
}

export function TransactionList({
  entries,
  startDate,
  endDate,
  entryType,
  scoutId,
  entryTypes,
  scouts,
  currentPage,
  totalPages,
  totalCount,
}: TransactionListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString())

    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    })

    // Reset to page 1 when filters change (except for pagination)
    if (!('page' in updates)) {
      params.delete('page')
    }

    router.push(`/finances/transactions?${params.toString()}`)
  }

  const clearFilters = () => {
    router.push('/finances/transactions')
  }

  const hasFilters = entryType || scoutId

  const formatDate = (dateString: string) => {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end p-4 bg-stone-50 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-stone-500" />
          <span className="text-sm font-medium text-stone-700">Filters:</span>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="startDate" className="text-sm">From:</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => updateFilters({ startDate: e.target.value })}
            className="w-36 h-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="endDate" className="text-sm">To:</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => updateFilters({ endDate: e.target.value })}
            className="w-36 h-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="entryType" className="text-sm">Type:</Label>
          <select
            id="entryType"
            value={entryType}
            onChange={(e) => updateFilters({ type: e.target.value })}
            className="h-8 rounded-md border border-stone-300 bg-white px-2 text-sm"
          >
            <option value="">All Types</option>
            {entryTypes.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="scoutId" className="text-sm">Scout:</Label>
          <select
            id="scoutId"
            value={scoutId}
            onChange={(e) => updateFilters({ scoutId: e.target.value })}
            className="h-8 rounded-md border border-stone-300 bg-white px-2 text-sm"
          >
            <option value="">All Scouts</option>
            {scouts.map((scout) => (
              <option key={scout.id} value={scout.id}>
                {scout.first_name} {scout.last_name}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Results count */}
      <p className="text-sm text-stone-500">
        Showing {entries.length} of {totalCount} transactions
        {' '}from {formatDate(startDate)} to {formatDate(endDate)}
      </p>

      {/* Transactions Table */}
      {entries.length > 0 ? (
        <ResponsiveTable>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm font-medium text-stone-500">
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3 pr-4">Description</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4">Scout</th>
                <th className="pb-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const totalAmount = entry.journal_lines.reduce(
                  (sum, line) => sum + (line.debit || 0),
                  0
                )

                // Get scout names from journal lines
                const scoutNames = entry.journal_lines
                  .filter((line) => line.scout_accounts?.scouts)
                  .map((line) => {
                    const scout = line.scout_accounts?.scouts
                    return scout ? `${scout.first_name} ${scout.last_name}` : null
                  })
                  .filter((name, index, self) => name && self.indexOf(name) === index)

                return (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b last:border-0',
                      entry.is_void && 'opacity-50 bg-stone-50'
                    )}
                  >
                    <td className="py-3 pr-4 text-stone-600">
                      {formatDate(entry.entry_date)}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-stone-900">
                        {entry.description}
                        {entry.is_void && (
                          <span className="ml-2 text-xs text-error">(VOID)</span>
                        )}
                      </p>
                      {entry.journal_lines.length > 1 && (
                        <p className="text-xs text-stone-500 mt-0.5">
                          {entry.journal_lines.length} line items
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded bg-stone-100 px-2 py-1 text-xs capitalize">
                        {entry.entry_type?.replace(/_/g, ' ') || 'entry'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-stone-600 text-sm">
                      {scoutNames.length > 0 ? (
                        scoutNames.length === 1 ? (
                          scoutNames[0]
                        ) : (
                          <span title={scoutNames.join(', ')}>
                            {scoutNames.length} scouts
                          </span>
                        )
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right font-medium font-mono">
                      {formatCurrency(totalAmount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ResponsiveTable>
      ) : (
        <div className="text-center py-12">
          <p className="text-stone-500">No transactions found for the selected filters.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-stone-500">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => updateFilters({ page: String(currentPage - 1) })}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => updateFilters({ page: String(currentPage + 1) })}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
