'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, cn } from '@/lib/utils'
import { Landmark, RefreshCw, ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import { BankTransactionsList } from './bank-transactions-list'

interface PlaidAccount {
  account_id: string
  name: string
  mask: string | null
  type: string
  subtype: string | null
  balance?: {
    available: number | null
    current: number | null
    limit: number | null
    currency: string
  }
}

interface PlaidConnection {
  id: string
  institution_name: string
  accounts: PlaidAccount[]
  status: 'active' | 'error' | 'disconnected'
  error_message: string | null
  last_synced_at: string | null
}

export function BankWidget() {
  const [connection, setConnection] = useState<PlaidConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConnection = async () => {
    try {
      const response = await fetch('/api/plaid/accounts')
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch bank data')
      }
      const data = await response.json()
      setConnection(data.connection)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bank data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConnection()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/plaid/accounts', { method: 'POST' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to sync')
      }
      const data = await response.json()
      setConnection(data.connection)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync')
    } finally {
      setSyncing(false)
    }
  }

  const formatLastSynced = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`

    return date.toLocaleDateString()
  }

  // Calculate total balance
  const totalBalance = connection?.accounts.reduce((sum, account) => {
    return sum + (account.balance?.current || 0)
  }, 0) || 0

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Bank Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!connection) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Bank Account
          </CardTitle>
          <CardDescription>Connect your bank in Settings</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href="/settings?tab=integrations">
              Connect Bank
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (connection.status === 'error') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            {connection.institution_name}
          </CardTitle>
          <CardDescription className="text-error">Connection error</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-error mb-3">
            <AlertCircle className="h-4 w-4" />
            {connection.error_message || 'Please reconnect your bank'}
          </div>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href="/settings?tab=integrations">
              Fix Connection
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              {connection.institution_name}
            </CardTitle>
            <CardDescription>
              Updated {formatLastSynced(connection.last_synced_at)}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-error mb-2">{error}</p>
        )}

        {/* Total Balance */}
        <div className="mb-4 p-3 bg-stone-50 rounded-lg">
          <p className="text-sm text-stone-500">Total Balance</p>
          <p className="text-2xl font-bold font-mono text-stone-900">
            {formatCurrency(totalBalance)}
          </p>
        </div>

        {/* Account List */}
        {connection.accounts.length > 1 && (
          <div className="space-y-2 mb-4">
            {connection.accounts.map((account) => (
              <div
                key={account.account_id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-stone-600">
                  {account.name}
                  {account.mask && <span className="text-stone-400"> ••••{account.mask}</span>}
                </span>
                <span className="font-mono font-medium">
                  {formatCurrency(account.balance?.current || 0)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent Transactions */}
        <div className="border-t pt-3">
          <p className="text-sm font-medium text-stone-700 mb-2">Recent Transactions</p>
          <BankTransactionsList compact />
        </div>
      </CardContent>
    </Card>
  )
}
