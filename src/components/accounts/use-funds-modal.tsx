'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { Wallet, ArrowRight, AlertCircle } from 'lucide-react'

interface UseFundsModalProps {
  isOpen: boolean
  onClose: () => void
  scoutAccountId: string
  scoutName: string
  billingBalance: number // negative = owes
  fundsBalance: number   // positive = available
}

export function UseFundsModal({
  isOpen,
  onClose,
  scoutAccountId,
  scoutName,
  billingBalance,
  fundsBalance,
}: UseFundsModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  const amountOwed = Math.abs(billingBalance)
  const maxTransfer = Math.min(fundsBalance, amountOwed)

  const handleTransfer = async () => {
    const transferAmount = parseFloat(amount)

    if (isNaN(transferAmount) || transferAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (transferAmount > fundsBalance) {
      setError(`Insufficient funds. Maximum available: ${formatCurrency(fundsBalance)}`)
      return
    }

    if (transferAmount > amountOwed) {
      setError(`Transfer amount exceeds amount owed: ${formatCurrency(amountOwed)}`)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const { data, error: rpcError } = await supabase.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: transferAmount,
        p_description: 'Transfer from Scout Funds to pay balance',
      })

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      // Close modal and refresh the page
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUseMax = () => {
    setAmount(maxTransfer.toFixed(2))
  }

  const parsedAmount = parseFloat(amount) || 0
  const remainingOwed = amountOwed - parsedAmount
  const remainingFunds = fundsBalance - parsedAmount

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-success" />
            Use Scout Funds
          </DialogTitle>
          <DialogDescription>
            Transfer from {scoutName}&apos;s Scout Funds to pay their billing balance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Balances */}
          <div className="flex justify-between rounded-lg bg-stone-50 p-4">
            <div>
              <p className="text-sm text-stone-500">Scout Funds</p>
              <p className="text-lg font-semibold text-success">{formatCurrency(fundsBalance)}</p>
            </div>
            <ArrowRight className="h-6 w-6 self-center text-stone-400" />
            <div className="text-right">
              <p className="text-sm text-stone-500">Amount Owed</p>
              <p className="text-lg font-semibold text-error">{formatCurrency(amountOwed)}</p>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Transfer Amount</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleUseMax}
                className="h-auto p-0 text-xs text-forest-600 hover:text-forest-800"
              >
                Use max ({formatCurrency(maxTransfer)})
              </Button>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={maxTransfer}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
          </div>

          {/* Preview */}
          {parsedAmount > 0 && parsedAmount <= maxTransfer && (
            <div className="rounded-lg border border-stone-200 p-4 text-sm">
              <p className="font-medium text-stone-700">After transfer:</p>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-stone-500">Remaining funds:</span>
                  <span className={remainingFunds > 0 ? 'text-success' : 'text-stone-600'}>
                    {formatCurrency(remainingFunds)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Remaining owed:</span>
                  <span className={remainingOwed > 0 ? 'text-error' : 'text-stone-600'}>
                    {remainingOwed > 0 ? formatCurrency(remainingOwed) : '$0.00'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-error-light p-3 text-sm text-error">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
          >
            {isSubmitting ? 'Transferring...' : 'Transfer Funds'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
