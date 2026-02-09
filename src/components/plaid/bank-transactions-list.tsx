'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, cn } from '@/lib/utils'
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Loader2 } from 'lucide-react'

interface Transaction {
  id: string
  date: string
  name: string
  merchant_name: string | null
  amount: number
  category: string[] | null
  pending: boolean
  account_id: string
}

interface Account {
  account_id: string
  name: string
  mask: string | null
}

interface BankTransactionsListProps {
  compact?: boolean
}

export function BankTransactionsList({ compact = false }: BankTransactionsListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const fetchTransactions = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/plaid/transactions?startDate=${startDate}&endDate=${endDate}`
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch transactions')
      }

      const data = await response.json()
      setTransactions(data.transactions || [])
      setAccounts(data.accounts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  const getAccountName = (accountId: string) => {
    const account = accounts.find((a) => a.account_id === accountId)
    return account ? `${account.name} ••••${account.mask}` : 'Unknown Account'
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  if (compact) {
    // Compact view for dashboard widget
    return (
      <div className="space-y-2">
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
          </div>
        )}

        {error && (
          <p className="text-sm text-error text-center py-2">{error}</p>
        )}

        {!loading && !error && transactions.length === 0 && (
          <p className="text-sm text-stone-500 text-center py-2">
            No recent transactions
          </p>
        )}

        {!loading && !error && transactions.slice(0, 5).map((tx) => (
          <div
            key={tx.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
          >
            <div className="flex items-center gap-2">
              {tx.amount > 0 ? (
                <ArrowDownLeft className="h-4 w-4 text-error" />
              ) : (
                <ArrowUpRight className="h-4 w-4 text-success" />
              )}
              <div>
                <p className="text-sm font-medium text-stone-900 truncate max-w-[150px]">
                  {tx.merchant_name || tx.name}
                </p>
                <p className="text-xs text-stone-500">{formatDate(tx.date)}</p>
              </div>
            </div>
            <span
              className={cn(
                'font-mono text-sm font-medium',
                tx.amount > 0 ? 'text-error' : 'text-success'
              )}
            >
              {tx.amount > 0 ? '-' : '+'}
              {formatCurrency(Math.abs(tx.amount))}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // Full view
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Bank Transactions</CardTitle>
            <CardDescription>
              Recent transactions from your connected bank account
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTransactions}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Date Range Filter */}
        <div className="flex flex-wrap gap-4 items-end mb-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="txStartDate" className="text-sm">
              From:
            </Label>
            <Input
              id="txStartDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-36 h-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="txEndDate" className="text-sm">
              To:
            </Label>
            <Input
              id="txEndDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-36 h-8"
            />
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-error">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && transactions.length === 0 && (
          <p className="text-center py-8 text-stone-500">
            No transactions found for the selected date range
          </p>
        )}

        {!loading && !error && transactions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm font-medium text-stone-500">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Description</th>
                  <th className="pb-3 pr-4">Account</th>
                  <th className="pb-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={cn(
                      'border-b last:border-0',
                      tx.pending && 'opacity-60'
                    )}
                  >
                    <td className="py-3 pr-4 text-stone-600">
                      {formatDate(tx.date)}
                      {tx.pending && (
                        <span className="ml-1 text-xs text-warning">(pending)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-stone-900">
                        {tx.merchant_name || tx.name}
                      </p>
                      {tx.category && tx.category.length > 0 && (
                        <p className="text-xs text-stone-500">
                          {tx.category.join(' › ')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-sm text-stone-600">
                      {getAccountName(tx.account_id)}
                    </td>
                    <td
                      className={cn(
                        'py-3 text-right font-medium font-mono',
                        tx.amount > 0 ? 'text-error' : 'text-success'
                      )}
                    >
                      {tx.amount > 0 ? '-' : '+'}
                      {formatCurrency(Math.abs(tx.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
