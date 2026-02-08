'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { recordQuickPayment } from '@/app/actions/payments'
import { Banknote, Check, Loader2 } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
  } | null
}

interface QuickPaymentFormProps {
  unitId: string
  scouts: Scout[]
  onSuccess?: () => void
}

const QUICK_AMOUNTS = [10, 20, 50, 100]

type QuickPaymentMethod = 'cash' | 'check'

export function QuickPaymentForm({ unitId, scouts, onSuccess }: QuickPaymentFormProps) {
  const router = useRouter()
  const [selectedScoutId, setSelectedScoutId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<QuickPaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Filter to scouts who owe money
  const scoutsOwing = scouts.filter((s) => (s.scout_accounts?.billing_balance || 0) < 0)

  const selectedScout = scouts.find((s) => s.id === selectedScoutId)
  const currentBalance = selectedScout?.scout_accounts?.billing_balance || 0
  const parsedAmount = parseFloat(amount) || 0

  const handleQuickAmount = (quickAmount: number) => {
    setAmount(quickAmount.toFixed(2))
  }

  const handlePayFullBalance = () => {
    if (currentBalance < 0) {
      setAmount(Math.abs(currentBalance).toFixed(2))
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedScout?.scout_accounts?.id) {
      setError('Please select a scout')
      return
    }
    if (parsedAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setIsSubmitting(true)
    setError(null)

    const result = await recordQuickPayment({
      unitId,
      scoutAccountId: selectedScout.scout_accounts.id,
      scoutName: `${selectedScout.first_name} ${selectedScout.last_name}`,
      amountDollars: parsedAmount,
      method,
      reference: reference || undefined,
    })

    setIsSubmitting(false)

    if (!result.success) {
      setError(result.error || 'Payment failed')
      return
    }

    setSuccess(true)
    setAmount('')
    setReference('')
    setSelectedScoutId('')

    onSuccess?.()

    // Refresh after showing success
    setTimeout(() => {
      setSuccess(false)
      router.refresh()
    }, 2000)
  }

  if (success) {
    return (
      <div className="rounded-lg border border-success/20 bg-success/5 p-4 text-center">
        <p className="font-medium text-success">Payment recorded successfully!</p>
        <p className="mt-1 text-sm text-stone-600">
          {formatCurrency(parsedAmount)} from {selectedScout?.first_name} {selectedScout?.last_name}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Scout Selector */}
      <div className="space-y-2">
        <Label htmlFor="quick-scout">Scout</Label>
        <select
          id="quick-scout"
          required
          disabled={isSubmitting}
          className="flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50"
          value={selectedScoutId}
          onChange={(e) => setSelectedScoutId(e.target.value)}
        >
          <option value="">Select scout...</option>
          {scoutsOwing.length > 0 && (
            <optgroup label="Scouts with balance due">
              {scoutsOwing.map((scout) => {
                const balance = scout.scout_accounts?.billing_balance || 0
                return (
                  <option key={scout.id} value={scout.id}>
                    {scout.first_name} {scout.last_name} (owes {formatCurrency(Math.abs(balance))})
                  </option>
                )
              })}
            </optgroup>
          )}
          {scouts.filter((s) => (s.scout_accounts?.billing_balance || 0) >= 0).length > 0 && (
            <optgroup label="Paid up">
              {scouts
                .filter((s) => (s.scout_accounts?.billing_balance || 0) >= 0)
                .map((scout) => (
                  <option key={scout.id} value={scout.id}>
                    {scout.first_name} {scout.last_name} (paid up)
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Balance Display */}
      {selectedScout && currentBalance < 0 && (
        <div className="flex items-center justify-between rounded-lg bg-stone-50 p-3">
          <span className="text-sm text-stone-600">
            Balance: <span className="font-medium text-error">{formatCurrency(currentBalance)}</span>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={handlePayFullBalance}>
            Pay Full Balance
          </Button>
        </div>
      )}

      {/* Amount with Quick Buttons */}
      <div className="space-y-2">
        <Label htmlFor="quick-amount">Amount</Label>
        <div className="flex gap-2">
          {QUICK_AMOUNTS.map((qa) => (
            <Button
              key={qa}
              type="button"
              variant={parsedAmount === qa ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleQuickAmount(qa)}
              disabled={isSubmitting}
              className="flex-1"
            >
              ${qa}
            </Button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
          <Input
            id="quick-amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            className="pl-7"
            onWheel={(e) => e.currentTarget.blur()}
          />
        </div>
      </div>

      {/* Payment Method Toggle */}
      <div className="space-y-2">
        <Label>Method</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={method === 'cash' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMethod('cash')}
            disabled={isSubmitting}
            className="flex-1"
          >
            <Banknote className="mr-2 h-4 w-4" />
            Cash
          </Button>
          <Button
            type="button"
            variant={method === 'check' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMethod('check')}
            disabled={isSubmitting}
            className="flex-1"
          >
            <Check className="mr-2 h-4 w-4" />
            Check
          </Button>
        </div>
      </div>

      {/* Check Reference (only for check) */}
      {method === 'check' && (
        <div className="space-y-2">
          <Label htmlFor="quick-reference">Check # (optional)</Label>
          <Input
            id="quick-reference"
            type="text"
            placeholder="1234"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || !selectedScoutId || parsedAmount <= 0}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Recording...
          </>
        ) : (
          `Record ${formatCurrency(parsedAmount)} Payment`
        )}
      </Button>
    </form>
  )
}
