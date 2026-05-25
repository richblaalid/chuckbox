'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { SQUARE_FEE_PERCENT, SQUARE_FEE_FIXED_DOLLARS } from '@/lib/billing'
import { createLogger } from '@/lib/logger'
import type { SquareCard, SquareTokenResult } from '@/types/square'

const log = createLogger('ParentPayment')

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
  } | null
}

interface BillingCharge {
  id: string
  amount: number
  is_paid: boolean | null
  billing_record_id: string
  scout_account_id: string
  billing_records: {
    description: string
    billing_date: string
  } | null
}

interface ParentPaymentFormProps {
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
  scouts: Scout[]
  unpaidCharges: BillingCharge[]
}

interface PaymentResult {
  success: boolean
  payment?: {
    id: string
    squarePaymentId: string
    amount: number
    receiptUrl?: string
  }
  error?: string
}

export function ParentPaymentForm({
  applicationId,
  locationId,
  environment,
  scouts,
  unpaidCharges,
}: ParentPaymentFormProps) {
  const router = useRouter()
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [sdkReady, setSdkReady] = useState(false)

  // Payment options
  const [paymentType, setPaymentType] = useState<'custom' | 'charges'>('custom')
  const [selectedScoutId, setSelectedScoutId] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [selectedChargeIds, setSelectedChargeIds] = useState<Set<string>>(new Set())

  // Calculate amounts
  const selectedScout = scouts.find((s) => s.id === selectedScoutId)
  const scoutAccount = selectedScout?.scout_accounts

  const selectedCharges = unpaidCharges.filter((c) => selectedChargeIds.has(c.id))
  const chargesTotal = selectedCharges.reduce((sum, c) => sum + c.amount, 0)

  const parsedCustomAmount = parseFloat(customAmount) || 0
  const paymentAmount = paymentType === 'custom' ? parsedCustomAmount : chargesTotal

  const feeAmount = paymentAmount > 0 ? paymentAmount * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_DOLLARS : 0
  const netAmount = paymentAmount - feeAmount

  // Load Square Web Payments SDK
  useEffect(() => {
    const sdkUrl =
      environment === 'production'
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
    script.onerror = () => setError('Failed to load Square payment SDK')
    document.body.appendChild(script)

    return () => {
      const existingScript = document.querySelector(`script[src="${sdkUrl}"]`)
      if (existingScript) {
        existingScript.remove()
      }
    }
  }, [environment])

  // Initialize card payment form
  const initializeCard = useCallback(async () => {
    if (!window.Square || !cardContainerRef.current) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      if (cardRef.current) {
        await cardRef.current.destroy()
        cardRef.current = null
      }

      const payments = await window.Square.payments(applicationId, locationId)
      const card = await payments.card()
      await card.attach('#parent-card-container')
      cardRef.current = card
      setIsLoading(false)
    } catch (err) {
      log.error('Failed to initialize Square card', err)
      setError('Failed to initialize payment form')
      setIsLoading(false)
    }
  }, [applicationId, locationId])

  useEffect(() => {
    if (sdkReady) {
      initializeCard()
    }

    return () => {
      if (cardRef.current) {
        cardRef.current.destroy().catch((err) => log.error('Error destroying card', err))
        cardRef.current = null
      }
    }
  }, [sdkReady, initializeCard])

  // Toggle charge selection
  const toggleCharge = (chargeId: string) => {
    const newSelected = new Set(selectedChargeIds)
    if (newSelected.has(chargeId)) {
      newSelected.delete(chargeId)
    } else {
      newSelected.add(chargeId)
    }
    setSelectedChargeIds(newSelected)

    // Auto-select the scout for the first selected charge
    if (newSelected.size > 0 && !selectedScoutId) {
      const firstCharge = unpaidCharges.find((c) => newSelected.has(c.id))
      if (firstCharge) {
        const scout = scouts.find((s) => s.scout_accounts?.id === firstCharge.scout_account_id)
        if (scout) {
          setSelectedScoutId(scout.id)
        }
      }
    }
  }

  // Select all charges for a scout
  const selectAllChargesForScout = (scoutId: string) => {
    const scout = scouts.find((s) => s.id === scoutId)
    if (!scout?.scout_accounts) return

    const scoutCharges = unpaidCharges.filter(
      (c) => c.scout_account_id === scout.scout_accounts!.id
    )
    const newSelected = new Set(scoutCharges.map((c) => c.id))
    setSelectedChargeIds(newSelected)
    setSelectedScoutId(scoutId)
    setPaymentType('charges')
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setPaymentResult(null)

    if (!cardRef.current) {
      setError('Payment form not ready')
      return
    }

    if (paymentType === 'custom') {
      if (!selectedScoutId || !scoutAccount) {
        setError('Please select a scout')
        return
      }
      if (parsedCustomAmount < 1) {
        setError('Minimum payment amount is $1.00')
        return
      }
    } else {
      if (selectedChargeIds.size === 0) {
        setError('Please select at least one charge to pay')
        return
      }
    }

    setIsProcessing(true)

    try {
      // Tokenize the card
      const tokenResult = await cardRef.current.tokenize()

      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const errorMessage = tokenResult.errors?.[0]?.message || 'Card verification failed'
        setError(errorMessage)
        setIsProcessing(false)
        return
      }

      // Determine which scout account to use
      let targetScoutAccountId: string
      let description: string

      if (paymentType === 'custom') {
        targetScoutAccountId = scoutAccount!.id
        description = `Payment for ${selectedScout?.first_name} ${selectedScout?.last_name}`
      } else {
        // Use the first selected charge's scout account
        const firstCharge = selectedCharges[0]
        targetScoutAccountId = firstCharge.scout_account_id
        const scout = scouts.find((s) => s.scout_accounts?.id === targetScoutAccountId)
        description = `Payment for ${selectedCharges.length} charge${selectedCharges.length !== 1 ? 's' : ''} - ${scout?.first_name} ${scout?.last_name}`
      }

      // Send payment to our API
      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scoutAccountId: targetScoutAccountId,
          amountCents: Math.round(paymentAmount * 100),
          sourceId: tokenResult.token,
          description,
          billingChargeId: paymentType === 'charges' && selectedCharges.length === 1
            ? selectedCharges[0].id
            : undefined,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      setPaymentResult({
        success: true,
        payment: result.payment,
      })

      // Reset form
      setCustomAmount('')
      setSelectedChargeIds(new Set())
      setSelectedScoutId('')

      // Reinitialize card form
      await initializeCard()

      // Refresh server components after delay to show updated balances
      setTimeout(() => {
        router.refresh()
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
      setPaymentResult({
        success: false,
        error: err instanceof Error ? err.message : 'Payment failed',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // If payment was successful, show confirmation
  if (paymentResult?.success) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-success-light p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-success">Payment Successful!</h3>
          <p className="mt-2 text-success">
            Your payment of {formatCurrency(paymentResult.payment?.amount || 0)} has been processed.
          </p>
          {paymentResult.payment?.receiptUrl && (
            <a
              href={paymentResult.payment.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center text-sm font-medium text-forest-600 hover:text-forest-700"
            >
              View Receipt &rarr;
            </a>
          )}
          <p className="mt-4 text-sm text-stone-500">Page will refresh shortly...</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Payment Type Toggle */}
      <div className="flex rounded-lg border border-stone-200 p-1">
        <button
          type="button"
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            paymentType === 'custom'
              ? 'bg-forest-600 text-white'
              : 'text-stone-600 hover:text-stone-900'
          }`}
          onClick={() => setPaymentType('custom')}
        >
          Custom Amount
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            paymentType === 'charges'
              ? 'bg-forest-600 text-white'
              : 'text-stone-600 hover:text-stone-900'
          }`}
          onClick={() => setPaymentType('charges')}
          disabled={unpaidCharges.length === 0}
        >
          Pay Charges ({unpaidCharges.length})
        </button>
      </div>

      {paymentType === 'custom' ? (
        <>
          {/* Scout Selection */}
          <div className="space-y-2">
            <Label htmlFor="parent-scout">Select Scout *</Label>
            <select
              id="parent-scout"
              required
              disabled={isLoading || isProcessing}
              className="flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50"
              value={selectedScoutId}
              onChange={(e) => setSelectedScoutId(e.target.value)}
            >
              <option value="">Select a scout...</option>
              {scouts.map((scout) => {
                const balance = scout.scout_accounts?.billing_balance || 0
                return (
                  <option key={scout.id} value={scout.id}>
                    {scout.first_name} {scout.last_name}{' '}
                    ({balance < 0 ? `owes ${formatCurrency(Math.abs(balance))}` : 'paid up'})
                  </option>
                )
              })}
            </select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="parent-amount">Amount *</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
              <input
                id="parent-amount"
                type="number"
                step="0.01"
                min="1"
                required
                disabled={isLoading || isProcessing}
                className="flex h-10 w-full rounded-md border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                placeholder="0.00"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            </div>
            {selectedScout && (
              <div className="flex gap-2">
                {(() => {
                  const balance = scoutAccount?.billing_balance || 0
                  if (balance < 0) {
                    return (
                      <button
                        type="button"
                        className="text-xs text-forest-600 hover:text-forest-700"
                        onClick={() => setCustomAmount(Math.abs(balance).toFixed(2))}
                      >
                        Pay full balance ({formatCurrency(Math.abs(balance))})
                      </button>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Charge Selection */}
          <div className="space-y-3">
            <Label>Select Charges to Pay *</Label>
            {scouts.map((scout) => {
              const scoutCharges = unpaidCharges.filter(
                (c) => c.scout_account_id === scout.scout_accounts?.id
              )
              if (scoutCharges.length === 0) return null

              const scoutTotal = scoutCharges.reduce((sum, c) => sum + c.amount, 0)
              const allSelected = scoutCharges.every((c) => selectedChargeIds.has(c.id))

              return (
                <div key={scout.id} className="rounded-lg border border-stone-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-stone-900">
                      {scout.first_name} {scout.last_name}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-forest-600 hover:text-forest-700"
                      onClick={() => selectAllChargesForScout(scout.id)}
                    >
                      {allSelected ? 'Selected' : `Select all (${formatCurrency(scoutTotal)})`}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {scoutCharges.map((charge) => (
                      <label
                        key={charge.id}
                        className={`flex cursor-pointer items-center justify-between rounded-md border p-2 transition-colors ${
                          selectedChargeIds.has(charge.id)
                            ? 'border-forest-600 bg-forest-50'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedChargeIds.has(charge.id)}
                            onChange={() => toggleCharge(charge.id)}
                            className="checkbox-native"
                          />
                          <div>
                            <p className="text-sm font-medium text-stone-900">
                              {charge.billing_records?.description || 'Charge'}
                            </p>
                            <p className="text-xs text-stone-500">
                              {charge.billing_records?.billing_date
                                ? new Date(charge.billing_records.billing_date).toLocaleDateString()
                                : ''}
                            </p>
                          </div>
                        </div>
                        <span className="font-medium text-stone-900">
                          {formatCurrency(charge.amount)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Card Input */}
      <div className="space-y-2">
        <Label>Card Details *</Label>
        <div
          id="parent-card-container"
          ref={cardContainerRef}
          className={`min-h-[50px] rounded-md border border-stone-300 bg-white p-3 ${
            isLoading ? 'animate-pulse bg-stone-100' : ''
          }`}
        >
          {isLoading && (
            <div className="text-sm text-stone-500">Loading payment form...</div>
          )}
        </div>
        <p className="text-xs text-stone-500">
          Payments are processed securely by Square. Card details never touch our servers.
        </p>
      </div>

      {/* Summary */}
      {paymentAmount > 0 && (
        <div className="rounded-lg bg-stone-50 p-4">
          <h4 className="font-medium text-stone-900">Payment Summary</h4>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-500">
                {paymentType === 'custom' ? 'Amount:' : `${selectedCharges.length} charge${selectedCharges.length !== 1 ? 's' : ''}:`}
              </span>
              <span className="font-medium text-stone-900">{formatCurrency(paymentAmount)}</span>
            </div>
            <div className="flex justify-between text-stone-500">
              <span>Processing Fee (2.6% + $0.10):</span>
              <span>-{formatCurrency(feeAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-medium">
              <span className="text-stone-700">Net to Unit:</span>
              <span className="text-stone-900">{formatCurrency(netAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        disabled={isLoading || isProcessing || paymentAmount < 1}
        className="w-full"
        size="lg"
      >
        {isProcessing
          ? 'Processing...'
          : isLoading
            ? 'Loading...'
            : `Pay ${paymentAmount > 0 ? formatCurrency(paymentAmount) : ''}`}
      </Button>
    </form>
  )
}
