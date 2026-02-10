'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { Landmark, Loader2, ArrowRight } from 'lucide-react'

interface PlaidAccount {
  account_id: string
  name: string
  balance?: {
    current: number | null
  }
}

interface PlaidConnection {
  id: string
  institution_name: string
  accounts: PlaidAccount[]
  status: 'active' | 'error' | 'disconnected'
  last_synced_at: string | null
}

interface BankBalanceCardProps {
  fallbackValue: number
  fallbackLabel: string
  fallbackDescription: string
}

export function BankBalanceCard({
  fallbackValue,
  fallbackLabel,
  fallbackDescription,
}: BankBalanceCardProps) {
  const [connection, setConnection] = useState<PlaidConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasBank, setHasBank] = useState(false)

  useEffect(() => {
    const fetchConnection = async () => {
      try {
        const response = await fetch('/api/plaid/accounts')
        if (response.ok) {
          const data = await response.json()
          if (data.connection && data.connection.status === 'active') {
            setConnection(data.connection)
            setHasBank(true)
          }
        }
      } catch {
        // Silently fail - will show fallback
      } finally {
        setLoading(false)
      }
    }

    fetchConnection()
  }, [])

  // Calculate total balance from connected accounts
  const totalBalance = connection?.accounts.reduce((sum, account) => {
    return sum + (account.balance?.current || 0)
  }, 0) || 0

  const formatLastSynced = (dateString: string | null) => {
    if (!dateString) return 'Never synced'
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

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </CardDescription>
          <CardTitle className="text-2xl text-stone-400">—</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">&nbsp;</p>
        </CardContent>
      </Card>
    )
  }

  // Show bank balance if connected
  if (hasBank && connection) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            Bank Balance
          </CardDescription>
          <CardTitle className="text-2xl text-stone-900">
            {formatCurrency(totalBalance)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {connection.institution_name} • {formatLastSynced(connection.last_synced_at)}
          </p>
        </CardContent>
      </Card>
    )
  }

  // Show fallback metric (Net to Collect)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {fallbackLabel}
        </CardDescription>
        <CardTitle className={`text-2xl ${fallbackValue > 0 ? 'text-amber-600' : 'text-stone-400'}`}>
          {fallbackValue > 0 ? formatCurrency(fallbackValue) : '—'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {fallbackValue > 0 ? fallbackDescription : (
            <Link href="/settings?tab=integrations" className="text-forest-600 hover:underline inline-flex items-center gap-1">
              Connect bank for balance <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
