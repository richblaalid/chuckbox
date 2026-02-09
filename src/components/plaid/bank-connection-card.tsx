'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PlaidLinkButton } from './plaid-link-button'
import { formatCurrency } from '@/lib/utils'
import { Landmark, RefreshCw, Unlink, AlertCircle } from 'lucide-react'

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

interface BankConnectionCardProps {
  connection: PlaidConnection | null
  isAdmin: boolean
}

export function BankConnectionCard({ connection, isAdmin }: BankConnectionCardProps) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/plaid/accounts', {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to sync accounts')
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync accounts')
    } finally {
      setSyncing(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect this bank account? You can reconnect at any time.')) {
      return
    }

    setDisconnecting(true)
    setError(null)

    try {
      const response = await fetch('/api/plaid/disconnect', {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to disconnect')
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  const formatLastSynced = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`

    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  }

  if (!connection) {
    // No connection - show connect button
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Bank Account
          </CardTitle>
          <CardDescription>
            Connect your unit&apos;s bank account to view balances and transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                Securely connect your bank account using Plaid. Your credentials are never stored by Chuckbox.
              </p>
              <PlaidLinkButton onSuccess={() => router.refresh()} />
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              Contact your unit admin to connect a bank account.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  // Connection exists
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              {connection.institution_name}
            </CardTitle>
            <CardDescription>
              {connection.status === 'active' ? (
                <>Last synced: {formatLastSynced(connection.last_synced_at)}</>
              ) : connection.status === 'error' ? (
                <span className="text-error">Connection error - please reconnect</span>
              ) : (
                <span className="text-stone-400">Disconnected</span>
              )}
            </CardDescription>
          </div>
          {isAdmin && connection.status === 'active' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-error hover:text-error hover:bg-error/10"
              >
                <Unlink className="h-4 w-4 mr-1" />
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-error">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {connection.status === 'error' && isAdmin && (
          <div className="mb-4 p-3 bg-error/10 rounded-lg">
            <p className="text-sm text-error mb-2">
              {connection.error_message || 'Your bank connection needs to be refreshed.'}
            </p>
            <PlaidLinkButton onSuccess={() => router.refresh()} />
          </div>
        )}

        {connection.accounts.length > 0 ? (
          <div className="space-y-3">
            {connection.accounts.map((account) => (
              <div
                key={account.account_id}
                className="flex items-center justify-between p-3 bg-stone-50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-stone-900">
                    {account.name}
                    {account.mask && (
                      <span className="ml-2 text-stone-400">••••{account.mask}</span>
                    )}
                  </p>
                  <p className="text-sm text-stone-500 capitalize">
                    {account.subtype || account.type}
                  </p>
                </div>
                {account.balance && (
                  <div className="text-right">
                    <p className="font-medium font-mono text-stone-900">
                      {formatCurrency(account.balance.current || 0)}
                    </p>
                    {account.balance.available !== null &&
                      account.balance.available !== account.balance.current && (
                        <p className="text-xs text-stone-500">
                          Available: {formatCurrency(account.balance.available)}
                        </p>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-500">No accounts found</p>
        )}
      </CardContent>
    </Card>
  )
}
