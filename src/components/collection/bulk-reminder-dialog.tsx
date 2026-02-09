'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { Mail, Loader2, CheckCircle2 } from 'lucide-react'

interface OverdueAccount {
  id: string
  billing_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: { name: string } | null
  } | null
  oldest_unpaid_date: string | null
  days_overdue: number
  guardians: {
    profile_id: string
    profiles: {
      id: string
      email: string | null
      first_name: string | null
      last_name: string | null
    } | null
  }[]
}

interface BulkReminderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: OverdueAccount[]
  unitId: string
  unitName: string
  onSuccess: () => void
}

export function BulkReminderDialog({
  open,
  onOpenChange,
  accounts,
  unitId,
  unitName,
  onSuccess,
}: BulkReminderDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  // Calculate totals
  const totalAmount = accounts.reduce((sum, a) => sum + Math.abs(a.billing_balance), 0)

  // Get unique guardians with emails
  const guardiansToEmail = accounts.flatMap(account =>
    account.guardians
      .filter(g => g.profiles?.email)
      .map(g => ({
        accountId: account.id,
        scoutName: `${account.scouts?.first_name} ${account.scouts?.last_name}`,
        guardianEmail: g.profiles?.email,
        guardianName: g.profiles?.first_name || g.profiles?.email?.split('@')[0],
        amount: Math.abs(account.billing_balance),
        daysOverdue: account.days_overdue,
      }))
  )

  const handleSend = async () => {
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/collection/send-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          accountIds: accounts.map(a => a.id),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reminders')
      }

      setResult({ sent: data.sent, failed: data.failed })

      // Auto-close after showing success for a moment
      setTimeout(() => {
        onSuccess()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminders')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Payment Reminders
          </DialogTitle>
          <DialogDescription>
            Send reminder emails to families with overdue balances
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {result ? (
            // Success state
            <div className="text-center py-6">
              <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <p className="text-lg font-medium text-stone-900">
                {result.sent} reminder{result.sent !== 1 ? 's' : ''} sent!
              </p>
              {result.failed > 0 && (
                <p className="text-sm text-warning mt-1">
                  {result.failed} failed to send
                </p>
              )}
              <p className="text-sm text-stone-500 mt-2">
                Closing automatically...
              </p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="rounded-lg bg-stone-50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">Scouts selected:</span>
                  <span className="font-medium">{accounts.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">Emails to send:</span>
                  <span className="font-medium">{guardiansToEmail.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-600">Total overdue:</span>
                  <span className="font-medium text-error">{formatCurrency(totalAmount)}</span>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-700">Recipients:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {guardiansToEmail.slice(0, 10).map((g, i) => (
                    <div key={i} className="text-sm text-stone-600 flex justify-between">
                      <span className="truncate">{g.guardianEmail}</span>
                      <span className="text-error ml-2">{formatCurrency(g.amount)}</span>
                    </div>
                  ))}
                  {guardiansToEmail.length > 10 && (
                    <p className="text-sm text-stone-400 italic">
                      +{guardiansToEmail.length - 10} more
                    </p>
                  )}
                </div>
              </div>

              {/* Info */}
              <p className="text-xs text-stone-500">
                Each guardian will receive a personalized email with their scout&apos;s balance and a payment link.
              </p>

              {error && (
                <p className="text-sm text-error">{error}</p>
              )}
            </>
          )}
        </div>

        {!result && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={isLoading || guardiansToEmail.length === 0}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Send {guardiansToEmail.length} Email{guardiansToEmail.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
