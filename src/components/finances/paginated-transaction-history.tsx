'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Receipt, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

interface Transaction {
  id: string
  debit: number | null
  credit: number | null
  memo: string | null
  journal_entries: {
    id: string
    entry_date: string
    created_at: string | null
    description: string
    entry_type: string | null
    is_posted: boolean | null
  } | null
}

interface PaginatedTransactionHistoryProps {
  scoutAccountId: string
  pageSize?: number
  showTitle?: boolean
  title?: string
  description?: string
}

export function PaginatedTransactionHistory({
  scoutAccountId,
  pageSize = 20,
  showTitle = true,
  title = 'Transaction History',
  description = 'All transactions on this account',
}: PaginatedTransactionHistoryProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPage = parseInt(searchParams.get('txPage') || '1', 10)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const totalPages = Math.ceil(totalCount / pageSize)

  useEffect(() => {
    async function fetchTransactions() {
      setIsLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const from = (currentPage - 1) * pageSize
        const to = from + pageSize - 1

        // Get total count
        const { count, error: countError } = await supabase
          .from('journal_lines')
          .select('id', { count: 'exact', head: true })
          .eq('scout_account_id', scoutAccountId)

        if (countError) throw countError
        setTotalCount(count || 0)

        // Get paginated transactions
        const { data, error: dataError } = await supabase
          .from('journal_lines')
          .select(`
            id,
            debit,
            credit,
            memo,
            journal_entries (
              id,
              entry_date,
              created_at,
              description,
              entry_type,
              is_posted
            )
          `)
          .eq('scout_account_id', scoutAccountId)
          .range(from, to)

        if (dataError) throw dataError

        // Sort by entry_date descending, then created_at descending for same-day entries
        const sorted = ((data as Transaction[]) || []).sort((a, b) => {
          const dateA = a.journal_entries?.entry_date || ''
          const dateB = b.journal_entries?.entry_date || ''
          if (dateA !== dateB) return dateB.localeCompare(dateA)
          const createdA = a.journal_entries?.created_at || ''
          const createdB = b.journal_entries?.created_at || ''
          return createdB.localeCompare(createdA)
        })
        setTransactions(sorted)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load transactions')
      } finally {
        setIsLoading(false)
      }
    }

    if (scoutAccountId) {
      fetchTransactions()
    }
  }, [scoutAccountId, currentPage, pageSize])

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (newPage === 1) {
      params.delete('txPage')
    } else {
      params.set('txPage', newPage.toString())
    }
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const content = (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
        </div>
      ) : error ? (
        <p className="py-4 text-center text-sm text-red-500">{error}</p>
      ) : transactions.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-stone-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Description</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4 text-right">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-stone-600">
                      {tx.journal_entries?.entry_date
                        ? new Date(tx.journal_entries.entry_date + 'T00:00:00').toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <p className="font-medium text-stone-900">
                        {tx.journal_entries?.description || tx.memo || '—'}
                      </p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant="outline" className="text-xs capitalize">
                        {tx.journal_entries?.entry_type || 'entry'}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-red-600">
                      {tx.debit && tx.debit > 0 ? formatCurrency(tx.debit) : '—'}
                    </td>
                    <td className="py-2.5 text-right text-emerald-600">
                      {tx.credit && tx.credit > 0 ? formatCurrency(tx.credit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <p className="text-sm text-stone-500">
                Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-stone-600">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="py-4 text-center text-sm text-stone-500">No transactions yet</p>
      )}
    </>
  )

  if (!showTitle) {
    return content
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-forest-600" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
