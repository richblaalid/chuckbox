'use client'

import { Button } from '@/components/ui/button'
import { formatCurrency, cn } from '@/lib/utils'
import { X, CreditCard, Wallet, PiggyBank, Bell, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface Transaction {
  id: string
  date: string
  description: string
  amount: number
}

interface ScoutData {
  id: string
  scoutId: string
  scoutName: string
  patrolName: string | null
  isActive: boolean
  billingBalance: number
  fundsBalance: number
  lastActivity: string | null
  recentTransactions: Transaction[]
}

interface ScoutDetailSidePanelProps {
  scout: ScoutData | null
  isOpen: boolean
  onClose: () => void
  onRecordPayment: (scoutId: string) => void
  onUseFunds: (scoutId: string) => void
  onAddFunds: (scoutId: string) => void
  onSendReminder: (scoutId: string) => void
}

export function ScoutDetailSidePanel({
  scout,
  isOpen,
  onClose,
  onRecordPayment,
  onUseFunds,
  onAddFunds,
  onSendReminder,
}: ScoutDetailSidePanelProps) {
  if (!scout) return null

  const owesBalance = scout.billingBalance < 0
  const hasFunds = scout.fundsBalance > 0

  // Determine which actions to show based on state
  type ActionType = 'recordPayment' | 'useFunds' | 'addFunds' | 'sendReminder'

  const getActions = (): ActionType[] => {
    if (owesBalance && hasFunds) {
      return ['recordPayment', 'useFunds', 'sendReminder']
    }
    if (owesBalance && !hasFunds) {
      return ['recordPayment', 'sendReminder']
    }
    if (!owesBalance && hasFunds) {
      return ['addFunds', 'useFunds']
    }
    // No balance, no funds
    return ['recordPayment', 'addFunds']
  }

  const actions = getActions()

  return (
    <div
      data-state={isOpen ? 'open' : 'closed'}
      className={cn(
        'fixed right-0 top-0 z-50 h-full w-[400px] transform border-l bg-background shadow-lg transition-transform duration-300',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <span className="text-sm text-muted-foreground">Scout Details</span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scout Info */}
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">{scout.scoutName}</h2>
        <p className="text-sm text-muted-foreground">
          {scout.patrolName ? `${scout.patrolName} Patrol` : 'No patrol'} · {scout.isActive ? 'Active' : 'Inactive'}
        </p>
      </div>

      {/* Balance Summary */}
      <div className="grid grid-cols-2 gap-4 border-b p-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Amount Owed</p>
          <p className={cn('text-xl font-bold', owesBalance ? 'text-destructive' : 'text-foreground')}>
            {formatCurrency(scout.billingBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Funds Balance</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(scout.fundsBalance)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-b p-4">
        {actions.includes('recordPayment') && (
          <Button variant="outline" size="sm" onClick={() => onRecordPayment(scout.scoutId)}>
            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
            Record Payment
          </Button>
        )}
        {actions.includes('useFunds') && (
          <Button variant="outline" size="sm" onClick={() => onUseFunds(scout.scoutId)}>
            <Wallet className="mr-1.5 h-3.5 w-3.5" />
            Use Funds to Pay
          </Button>
        )}
        {actions.includes('addFunds') && (
          <Button variant="outline" size="sm" onClick={() => onAddFunds(scout.scoutId)}>
            <PiggyBank className="mr-1.5 h-3.5 w-3.5" />
            Add Funds
          </Button>
        )}
        {actions.includes('sendReminder') && (
          <Button variant="outline" size="sm" onClick={() => onSendReminder(scout.scoutId)}>
            <Bell className="mr-1.5 h-3.5 w-3.5" />
            Send Reminder
          </Button>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="p-4">
        <h3 className="mb-3 text-sm font-medium">Recent Transactions</h3>
        {scout.recentTransactions.length > 0 ? (
          <div className="space-y-2">
            {scout.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-muted-foreground">
                    {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                  <p>{tx.description}</p>
                </div>
                <span className={cn('font-medium', tx.amount >= 0 ? 'text-green-600' : 'text-foreground')}>
                  {tx.amount >= 0 ? '+' : ''}
                  {formatCurrency(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent transactions</p>
        )}

        <Link
          href={`/scouts/${scout.scoutId}`}
          className="mt-4 flex items-center text-sm text-primary hover:underline"
        >
          View Full History
          <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
