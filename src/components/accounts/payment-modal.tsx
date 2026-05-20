'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { SQUARE_FEE_PERCENT, SQUARE_FEE_FIXED_DOLLARS } from '@/lib/billing'
import type { SquareCard } from '@/types/square'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  scoutAccountId: string
  scoutName: string
  currentBalance: number
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

export function PaymentModal({
  isOpen,
  onClose,
  scoutAccountId,
  scoutName,
  currentBalance,
  applicationId,
  locationId,
  environment,
}: PaymentModalProps) {
  const router = useRouter()
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [amount, setAmount] = useState('')
  const [sdkReady, setSdkReady] = useState(false)

  const amountOwed = Math.abs(currentBalance)
  const parsedAmount = parseFloat(amount) || 0
  const feeAmount = parsedAmount > 0 ? parsedAmount * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_DOLLARS : 0
  const totalCharge = parsedAmount + feeAmount

  // Load Square Web Payments SDK
  useEffect(() => {
    if (!isOpen) return

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
  }, [environment, isOpen])

  // Initialize card payment form
  const initializeCard = useCallback(async () => {
    if (!window.Square || !cardContainerRef.current || !isOpen) {
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
      await card.attach('#payment-card-container')
      cardRef.current = card
      setIsLoading(false)
    } catch (err) {
      console.error('Failed to initialize Square card:', err)
      setError('Failed to initialize payment form')
      setIsLoading(false)
    }
  }, [applicationId, locationId, isOpen])

  useEffect(() => {
    if (sdkReady && isOpen) {
      initializeCard()
    }

    return () => {
      if (cardRef.current) {
        cardRef.current.destroy().catch(console.error)
        cardRef.current = null
      }
    }
  }, [sdkReady, isOpen, initializeCard])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount('')
      setError(null)
      setSuccess(false)
    }
  }, [isOpen])

  const handlePayFullBalance = () => {
    setAmount(amountOwed.toFixed(2))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!cardRef.current) {
      setError('Payment form not ready')
      return
    }

    if (parsedAmount < 1) {
      setError('Minimum payment amount is $1.00')
      return
    }

    setIsProcessing(true)

    try {
      const tokenResult = await cardRef.current.tokenize()

      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const errorMessage = tokenResult.errors?.[0]?.message || 'Card verification failed'
        setError(errorMessage)
        setIsProcessing(false)
        return
      }

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scoutAccountId,
          amountCents: Math.round(parsedAmount * 100),
          sourceId: tokenResult.token,
          description: `Payment for ${scoutName}`,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      setSuccess(true)

      setTimeout(() => {
        onClose()
        router.refresh()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setIsProcessing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-stone-900">Make a Payment</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4">
          <p className="text-stone-600">Payment for <span className="font-medium">{scoutName}</span></p>
          <p className="mt-1">
            <span className="text-stone-500">Current Balance: </span>
            <span className="text-lg font-semibold text-error">{formatCurrency(currentBalance)}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-amount">Amount *</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
                <input
                  id="payment-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  max={amountOwed}
                  required
                  disabled={isLoading || isProcessing}
                  className="flex h-10 w-full rounded-md border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handlePayFullBalance}
                disabled={isLoading || isProcessing}
                className="whitespace-nowrap"
              >
                Pay Full Balance
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Card Details *</Label>
            <div
              id="payment-card-container"
              ref={cardContainerRef}
              className={`min-h-[50px] rounded-md border border-stone-300 bg-white p-3 ${
                isLoading ? 'animate-pulse bg-stone-100' : ''
              }`}
            >
              {isLoading && <div className="text-sm text-stone-500">Loading payment form...</div>}
            </div>
            <p className="text-xs text-stone-500">
              Payments are processed securely by Square.
            </p>
          </div>

          {parsedAmount > 0 && (
            <div className="rounded-lg bg-stone-50 p-4">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">Payment Amount:</span>
                  <span className="font-medium text-stone-900">{formatCurrency(parsedAmount)}</span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>Processing Fee (2.6% + $0.10):</span>
                  <span>{formatCurrency(feeAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1 font-medium">
                  <span className="text-stone-700">Total Charge:</span>
                  <span className="text-stone-900">{formatCurrency(totalCharge)}</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1">
                  <span className="text-stone-500">New Balance:</span>
                  <span className={currentBalance + parsedAmount < 0 ? 'text-error' : 'text-success'}>
                    {formatCurrency(currentBalance + parsedAmount)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg bg-success-light p-3 text-sm font-medium text-success">
              Payment processed successfully! Refreshing...
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || isProcessing || parsedAmount < 1}
              className="flex-1"
            >
              {isProcessing ? 'Processing...' : isLoading ? 'Loading...' : 'Submit Payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
