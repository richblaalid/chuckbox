'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { recordQuickPayment } from '@/app/actions/payments'
import { SQUARE_FEE_PERCENT, SQUARE_FEE_FIXED_DOLLARS } from '@/lib/billing'
import { trackPaymentInitiated, trackPaymentCompleted, trackPaymentFailed } from '@/lib/analytics'
import { Banknote, Check, CreditCard, Loader2, X, Wallet } from 'lucide-react'
import type { SquareCard } from '@/types/square'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance?: number | null
  } | null
}

interface QuickPaymentFormProps {
  unitId: string
  scouts: Scout[]
  /** Square configuration - if provided, card payments are enabled */
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
  /** Pre-select a specific scout (for account detail page) */
  preselectedScoutId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

const QUICK_AMOUNTS = [10, 20, 50, 100]

type PaymentMethod = 'cash' | 'check' | 'card' | 'balance'

export function QuickPaymentForm({
  unitId,
  scouts,
  squareConfig,
  preselectedScoutId,
  onSuccess,
  onCancel,
}: QuickPaymentFormProps) {
  const router = useRouter()
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)

  const [selectedScoutId, setSelectedScoutId] = useState(preselectedScoutId || '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Square SDK state
  const [sdkReady, setSdkReady] = useState(false)
  const [cardInitialized, setCardInitialized] = useState(false)
  const [isCardLoading, setIsCardLoading] = useState(false)

  const isSquareEnabled = !!squareConfig?.locationId

  // Filter to scouts who owe money
  const scoutsOwing = scouts.filter((s) => (s.scout_accounts?.billing_balance || 0) < 0)

  const selectedScout = scouts.find((s) => s.id === selectedScoutId)
  const currentBalance = selectedScout?.scout_accounts?.billing_balance || 0
  const fundsBalance = selectedScout?.scout_accounts?.funds_balance || 0
  const parsedAmount = parseFloat(amount) || 0

  // Check if scout has funds available to use
  const hasFunds = fundsBalance > 0 && currentBalance < 0
  const maxFromFunds = Math.min(fundsBalance, Math.abs(currentBalance))

  // Calculate fees for card payments
  const isCardPayment = method === 'card'
  const feeAmount = isCardPayment ? parsedAmount * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_DOLLARS : 0
  const netAmount = parsedAmount - feeAmount

  // Calculate new balance after payment
  const newBalance = currentBalance + parsedAmount

  // Reset method if switching to scout without funds
  useEffect(() => {
    if (method === 'balance' && !hasFunds) {
      setMethod('cash')
    }
  }, [selectedScoutId, hasFunds, method])

  // Load Square SDK when card method is selected
  useEffect(() => {
    if (!isSquareEnabled || method !== 'card') return

    const sdkUrl =
      squareConfig.environment === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js'

    if (window.Square) {
      setSdkReady(true)
      return
    }

    const script = document.createElement('script')
    script.src = sdkUrl
    script.async = true
    script.onload = () => setSdkReady(true)
    script.onerror = () => setError('Failed to load payment SDK')
    document.body.appendChild(script)
  }, [isSquareEnabled, method, squareConfig?.environment])

  // Initialize card form
  const initializeCard = useCallback(async () => {
    if (!squareConfig || !window.Square || !cardContainerRef.current) return

    setIsCardLoading(true)
    try {
      const payments = await window.Square.payments(squareConfig.applicationId, squareConfig.locationId)
      const card = await payments.card()
      await card.attach(cardContainerRef.current)
      cardRef.current = card
      setCardInitialized(true)
    } catch (err) {
      setError('Failed to initialize payment form')
      console.error('Card init error:', err)
    } finally {
      setIsCardLoading(false)
    }
  }, [squareConfig])

  // Initialize card when SDK ready and card tab selected
  useEffect(() => {
    if (sdkReady && method === 'card' && !cardInitialized && !isCardLoading) {
      initializeCard()
    }
  }, [sdkReady, method, cardInitialized, isCardLoading, initializeCard])

  // Cleanup card when switching methods
  useEffect(() => {
    if (method !== 'card' && cardRef.current) {
      cardRef.current.destroy().catch(() => {})
      cardRef.current = null
      setCardInitialized(false)
    }
  }, [method])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cardRef.current) {
        cardRef.current.destroy().catch(() => {})
      }
    }
  }, [])

  const handleQuickAmount = (quickAmount: number) => {
    setAmount(quickAmount.toFixed(2))
  }

  const handlePayFullBalance = () => {
    if (currentBalance < 0) {
      setAmount(Math.abs(currentBalance).toFixed(2))
    }
  }

  const handleUseMaxFunds = () => {
    setAmount(maxFromFunds.toFixed(2))
  }

  const handleCancel = () => {
    // Clear all form state
    setSelectedScoutId(preselectedScoutId || '')
    setAmount('')
    setMethod('cash')
    setReference('')
    setNotes('')
    setError(null)
    setSuccess(false)
    onCancel?.()
  }

  const handleCardPayment = async () => {
    if (!cardRef.current || !selectedScout?.scout_accounts?.id) return

    trackPaymentInitiated({
      amount: parsedAmount,
      scoutAccountId: selectedScout.scout_accounts.id,
      method: 'card',
    })

    try {
      const tokenResult = await cardRef.current.tokenize()
      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        throw new Error(tokenResult.errors?.[0]?.message || 'Card verification failed')
      }

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoutAccountId: selectedScout.scout_accounts.id,
          amountCents: Math.round(parsedAmount * 100),
          sourceId: tokenResult.token,
          description: `Payment for ${selectedScout.first_name} ${selectedScout.last_name}`,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      trackPaymentCompleted({
        amount: parsedAmount,
        fee: feeAmount,
        net: netAmount,
        scoutAccountId: selectedScout.scout_accounts.id,
        method: 'card',
      })

      return true
    } catch (err) {
      trackPaymentFailed({
        amount: parsedAmount,
        errorType: err instanceof Error ? err.message : 'Unknown error',
        scoutAccountId: selectedScout.scout_accounts.id,
      })
      throw err
    }
  }

  const handleBalancePayment = async () => {
    if (!selectedScout?.scout_accounts?.id) return

    trackPaymentInitiated({
      amount: parsedAmount,
      scoutAccountId: selectedScout.scout_accounts.id,
      method: 'transfer',
    })

    try {
      const supabase = createClient()

      const { error: rpcError } = await supabase.rpc('transfer_funds_to_billing', {
        p_scout_account_id: selectedScout.scout_accounts.id,
        p_amount: parsedAmount,
        p_description: notes || 'Transfer from Scout Funds to pay balance',
      })

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      trackPaymentCompleted({
        amount: parsedAmount,
        scoutAccountId: selectedScout.scout_accounts.id,
        method: 'transfer',
      })

      return true
    } catch (err) {
      trackPaymentFailed({
        amount: parsedAmount,
        errorType: err instanceof Error ? err.message : 'Unknown error',
        scoutAccountId: selectedScout.scout_accounts.id,
      })
      throw err
    }
  }

  const handleManualPayment = async () => {
    if (!selectedScout?.scout_accounts?.id) return

    const paymentMethod = method as 'cash' | 'check'

    trackPaymentInitiated({
      amount: parsedAmount,
      scoutAccountId: selectedScout.scout_accounts.id,
      method: paymentMethod,
    })

    try {
      const result = await recordQuickPayment({
        unitId,
        scoutAccountId: selectedScout.scout_accounts.id,
        scoutName: `${selectedScout.first_name} ${selectedScout.last_name}`,
        amountDollars: parsedAmount,
        method: paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
      })

      if (!result.success) {
        throw new Error(result.error || 'Payment failed')
      }

      trackPaymentCompleted({
        amount: parsedAmount,
        scoutAccountId: selectedScout.scout_accounts.id,
        method: paymentMethod,
      })

      return true
    } catch (err) {
      trackPaymentFailed({
        amount: parsedAmount,
        errorType: err instanceof Error ? err.message : 'Unknown error',
        scoutAccountId: selectedScout.scout_accounts.id,
      })
      throw err
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
    if (method === 'card' && parsedAmount < 1) {
      setError('Minimum card payment is $1.00')
      return
    }
    if (method === 'balance' && parsedAmount > fundsBalance) {
      setError(`Insufficient funds. Maximum available: ${formatCurrency(fundsBalance)}`)
      return
    }
    if (method === 'balance' && parsedAmount > Math.abs(currentBalance)) {
      setError(`Amount exceeds balance owed: ${formatCurrency(Math.abs(currentBalance))}`)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (method === 'card') {
        await handleCardPayment()
      } else if (method === 'balance') {
        await handleBalancePayment()
      } else {
        await handleManualPayment()
      }

      setSuccess(true)
      onSuccess?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setIsSubmitting(false)
    }
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
      {/* Scout Selector - hide if preselected */}
      {!preselectedScoutId && (
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
                  const funds = scout.scout_accounts?.funds_balance || 0
                  return (
                    <option key={scout.id} value={scout.id}>
                      {scout.first_name} {scout.last_name} (owes {formatCurrency(Math.abs(balance))}
                      {funds > 0 ? `, has ${formatCurrency(funds)} funds` : ''})
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
      )}

      {/* Balance Display */}
      {selectedScout && currentBalance < 0 && (
        <div className="flex items-center justify-between rounded-lg bg-stone-50 p-3">
          <div className="text-sm">
            <span className="text-stone-600">
              Owes: <span className="font-medium text-error">{formatCurrency(Math.abs(currentBalance))}</span>
            </span>
            {fundsBalance > 0 && (
              <span className="ml-3 text-stone-600">
                Funds: <span className="font-medium text-success">{formatCurrency(fundsBalance)}</span>
              </span>
            )}
          </div>
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={method === 'cash' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMethod('cash')}
            disabled={isSubmitting}
            className="flex-1"
          >
            <Banknote className="mr-1.5 h-4 w-4" />
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
            <Check className="mr-1.5 h-4 w-4" />
            Check
          </Button>
          {isSquareEnabled && (
            <Button
              type="button"
              variant={method === 'card' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMethod('card')}
              disabled={isSubmitting}
              className="flex-1"
            >
              <CreditCard className="mr-1.5 h-4 w-4" />
              Card
            </Button>
          )}
          {hasFunds && (
            <Button
              type="button"
              variant={method === 'balance' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setMethod('balance')
                // Auto-fill max amount from funds
                handleUseMaxFunds()
              }}
              disabled={isSubmitting}
              className="flex-1"
            >
              <Wallet className="mr-1.5 h-4 w-4" />
              From Funds
            </Button>
          )}
        </div>
      </div>

      {/* From Funds Info */}
      {method === 'balance' && (
        <div className="rounded-lg border border-success/20 bg-success/5 p-3">
          <p className="text-sm text-stone-600">
            Using Scout Funds to pay balance.{' '}
            <button
              type="button"
              onClick={handleUseMaxFunds}
              className="font-medium text-forest-600 hover:text-forest-800"
            >
              Use max ({formatCurrency(maxFromFunds)})
            </button>
          </p>
        </div>
      )}

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

      {/* Card Payment Form */}
      {method === 'card' && (
        <div className="space-y-2">
          <Label>Card Details</Label>
          <div
            ref={cardContainerRef}
            className="min-h-[44px] rounded-md border border-stone-300 bg-white p-3"
          >
            {isCardLoading && (
              <div className="flex items-center justify-center text-sm text-stone-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading card form...
              </div>
            )}
          </div>
          {parsedAmount > 0 && (
            <p className="text-xs text-stone-500">
              Fee: {formatCurrency(feeAmount)} | Net: {formatCurrency(netAmount)}
            </p>
          )}
        </div>
      )}

      {/* Notes (optional) */}
      <div className="space-y-2">
        <Label htmlFor="quick-notes">Notes (optional)</Label>
        <Input
          id="quick-notes"
          type="text"
          placeholder="Payment notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {/* New Balance Preview */}
      {selectedScout && parsedAmount > 0 && currentBalance < 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm font-medium text-stone-700">After payment:</p>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-stone-500">New balance:</span>
            <span className={newBalance >= 0 ? 'font-medium text-success' : 'font-medium text-error'}>
              {newBalance >= 0 ? 'Paid up' : formatCurrency(newBalance)}
              {newBalance > 0 && ` (+${formatCurrency(newBalance)} credit)`}
            </span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="flex-1"
          >
            <X className="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="default"
          className="flex-1"
          disabled={
            isSubmitting ||
            !selectedScoutId ||
            parsedAmount <= 0 ||
            (method === 'card' && !cardInitialized)
          }
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : method === 'balance' ? (
            `Use ${formatCurrency(parsedAmount)} Funds`
          ) : (
            `Record ${formatCurrency(parsedAmount)}`
          )}
        </Button>
      </div>
    </form>
  )
}
