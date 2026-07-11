'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import type { SquareCard } from '@/types/square'
import { logger } from '@/lib/logger'

interface PaymentLinkData {
  id: string
  currentBillingCents: number  // Amount owed (billing balance)
  availableFundsCents: number  // Scout Funds available
  billingChargeId: string | null
  chargeInfo: {
    id: string
    amount: number
    description: string
    isPaid: boolean
  } | null
  feePercent: number
  feeFixedCents: number
  feesPassedToPayer: boolean
  description: string
  scoutName: string
  scoutAccountId: string
  unitName: string
  unitLogoUrl: string | null
  expiresAt: string
  squareEnabled: boolean
  squareLocationId: string | null
}

interface PaymentResult {
  id: string
  squarePaymentId?: string
  amount: number
  creditedAmount?: number
  creditApplied?: number
  feeAmount?: number
  netAmount?: number
  receiptUrl?: string
  status?: string
  remainingBalance?: number
  remainingCredit?: number
  paymentMethod?: string
  scoutName?: string
  chargeMarkedPaid?: boolean
}

function formatCurrency(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amountCents / 100)
}

function formatDollars(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

const MIN_PAYMENT_CENTS = 100 // $1.00 minimum

export default function PaymentCheckoutPage() {
  const params = useParams()
  const token = params.token as string

  const [linkData, setLinkData] = useState<PaymentLinkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  // Payment amount state (in dollars for input)
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [isCustomAmount, setIsCustomAmount] = useState(false)

  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  const [cardLoading, setCardLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isProcessingBalance, setIsProcessingBalance] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [useScoutFunds, setUseScoutFunds] = useState(false)

  const environment = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT || 'sandbox'
  const applicationId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID || ''
  const locationId = linkData?.squareLocationId || ''

  // Calculate scout funds application
  const fundsCalculation = useMemo(() => {
    if (!linkData) return null

    const availableFunds = linkData.availableFundsCents
    const amountDue = linkData.chargeInfo?.amount || linkData.currentBillingCents
    const fundsToApply = Math.min(availableFunds, amountDue)
    const remainingAfterFunds = amountDue - fundsToApply
    const fundsCoversAll = fundsToApply >= amountDue

    return {
      availableFunds,
      amountDue,
      fundsToApply,
      remainingAfterFunds,
      fundsCoversAll,
    }
  }, [linkData])

  // Calculate fee and total based on entered amount
  const paymentCalculation = useMemo(() => {
    if (!linkData) return null

    const inputDollars = parseFloat(paymentAmountInput) || 0
    const baseAmountCents = Math.round(inputDollars * 100)

    // If using scout funds, the max is reduced by funds amount
    const effectiveMax = useScoutFunds && fundsCalculation
      ? fundsCalculation.remainingAfterFunds
      : linkData.currentBillingCents

    // Validate amount - if funds cover all, no card payment needed
    const fundsCoversAll = useScoutFunds && fundsCalculation?.fundsCoversAll
    const isValid = fundsCoversAll || (baseAmountCents >= MIN_PAYMENT_CENTS && baseAmountCents <= effectiveMax)

    // Calculate fee if passed to payer
    let feeAmountCents = 0
    let totalAmountCents = baseAmountCents

    if (linkData.feesPassedToPayer && baseAmountCents > 0) {
      feeAmountCents = Math.ceil((baseAmountCents * linkData.feePercent) + linkData.feeFixedCents)
      totalAmountCents = baseAmountCents + feeAmountCents
    }

    return {
      baseAmountCents,
      feeAmountCents,
      totalAmountCents,
      isValid,
      maxAmountCents: effectiveMax,
    }
  }, [linkData, paymentAmountInput, useScoutFunds, fundsCalculation])

  // Fetch payment link data
  useEffect(() => {
    async function fetchLinkData() {
      try {
        const response = await fetch(`/api/payment-links/${token}`)
        const data = await response.json()

        if (!response.ok) {
          setLinkError(data.error || 'Invalid payment link')
          return
        }

        setLinkData(data)
        // Set default amount to full billing balance
        const balanceDollars = (data.currentBillingCents / 100).toFixed(2)
        setPaymentAmountInput(balanceDollars)
      } catch {
        setLinkError('Failed to load payment link')
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      fetchLinkData()
    }
  }, [token])

  // Load Square Web Payments SDK
  useEffect(() => {
    if (!linkData?.squareEnabled || paymentSuccess) return

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
    script.onerror = () => setError('Failed to load payment SDK')
    document.body.appendChild(script)

    return () => {
      const existingScript = document.querySelector(`script[src="${sdkUrl}"]`)
      if (existingScript) {
        existingScript.remove()
      }
    }
  }, [environment, linkData?.squareEnabled, paymentSuccess])

  // Initialize card payment form
  const initializeCard = useCallback(async () => {
    if (!window.Square || !cardContainerRef.current || !applicationId || !locationId) {
      return
    }

    try {
      setCardLoading(true)
      setError(null)

      if (cardRef.current) {
        await cardRef.current.destroy()
        cardRef.current = null
      }

      const payments = await window.Square.payments(applicationId, locationId)
      const card = await payments.card()
      await card.attach('#card-container')
      cardRef.current = card
      setCardLoading(false)
    } catch (err) {
      logger.payment.error('Failed to initialize Square card', err)
      setError('Failed to initialize payment form')
      setCardLoading(false)
    }
  }, [applicationId, locationId])

  useEffect(() => {
    if (sdkReady && linkData?.squareEnabled && !paymentSuccess) {
      initializeCard()
    }

    return () => {
      if (cardRef.current) {
        cardRef.current.destroy().catch((err) => logger.payment.error('Failed to destroy Square card', err))
        cardRef.current = null
      }
    }
  }, [sdkReady, linkData?.squareEnabled, paymentSuccess, initializeCard])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!cardRef.current) {
      setError('Payment form not ready')
      return
    }

    if (!paymentCalculation?.isValid) {
      setError(`Please enter an amount between ${formatCurrency(MIN_PAYMENT_CENTS)} and ${formatCurrency(paymentCalculation?.maxAmountCents || 0)}`)
      return
    }

    setIsProcessing(true)

    try {
      let fundsApplied = 0

      // First apply scout funds if user opted to use them
      if (useScoutFunds && fundsCalculation && fundsCalculation.fundsToApply > 0) {
        const fundsResponse = await fetch(`/api/payment-links/${token}/pay-with-balance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountCents: fundsCalculation.fundsToApply }),
        })

        const fundsResult = await fundsResponse.json()

        if (!fundsResponse.ok) {
          throw new Error(fundsResult.error || 'Failed to apply scout funds')
        }

        fundsApplied = fundsCalculation.fundsToApply
      }

      // Then process card payment
      const tokenResult = await cardRef.current.tokenize()

      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const errorMessage = tokenResult.errors?.[0]?.message || 'Card verification failed'
        setError(errorMessage)
        setIsProcessing(false)
        return
      }

      const response = await fetch(`/api/payment-links/${token}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceId: tokenResult.token,
          amountCents: paymentCalculation.baseAmountCents,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      setPaymentSuccess(true)
      setPaymentResult({
        ...result.payment,
        creditApplied: fundsApplied > 0 ? fundsApplied / 100 : undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // Allow empty, numbers, and one decimal point with up to 2 decimal places
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setPaymentAmountInput(value)
      setIsCustomAmount(true)
    }
  }

  const handlePayFullBalance = () => {
    if (linkData) {
      setPaymentAmountInput((linkData.currentBillingCents / 100).toFixed(2))
      setIsCustomAmount(false)
    }
  }

  const handlePayWithBalance = async (amountCents: number) => {
    if (!linkData) return

    setIsProcessingBalance(true)
    setError(null)

    try {
      const response = await fetch(`/api/payment-links/${token}/pay-with-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Balance payment failed')
      }

      setPaymentSuccess(true)
      setPaymentResult({
        id: result.payment.id,
        amount: result.payment.amount,
        paymentMethod: 'balance',
        remainingCredit: result.remainingCredit,
        remainingBalance: result.remainingBalance,
        chargeMarkedPaid: result.chargeMarkedPaid,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Balance payment failed')
    } finally {
      setIsProcessingBalance(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-800 mx-auto"></div>
          <p className="mt-4 text-stone-600">Loading payment details...</p>
        </div>
      </div>
    )
  }

  // Link error state
  if (linkError) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-stone-900 mb-2">Payment Link Invalid</h1>
          <p className="text-stone-600">{linkError}</p>
          <p className="mt-4 text-sm text-stone-500">
            Please contact your scout unit if you believe this is an error.
          </p>
        </div>
      </div>
    )
  }

  // Success state
  if (paymentSuccess && paymentResult) {
    const isFundsPayment = paymentResult.paymentMethod === 'balance'
    const hasFundsApplied = paymentResult.creditApplied && paymentResult.creditApplied > 0
    const creditedAmount = paymentResult.creditedAmount ?? paymentResult.amount
    const totalApplied = (hasFundsApplied ? paymentResult.creditApplied! : 0) + (isFundsPayment ? paymentResult.amount : creditedAmount)
    const remainingBalance = paymentResult.remainingBalance ??
      (linkData ? (linkData.currentBillingCents - (totalApplied * 100)) / 100 : 0)

    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-stone-900 mb-2">
            {isFundsPayment ? 'Scout Funds Applied!' : 'Payment Successful!'}
          </h1>
          <p className="text-stone-600 mb-4">
            {isFundsPayment
              ? `${formatDollars(paymentResult.amount)} from Scout Funds has been applied.`
              : hasFundsApplied
                ? `Your payment of ${formatDollars(totalApplied)} has been processed.`
                : `Your payment of ${formatDollars(creditedAmount)} has been processed.`}
          </p>
          <div className="bg-stone-50 rounded-lg p-4 text-left text-sm">
            {hasFundsApplied && (
              <div className="flex justify-between mb-2">
                <span className="text-stone-500">Scout Funds Applied:</span>
                <span className="font-medium text-forest-600">{formatDollars(paymentResult.creditApplied!)}</span>
              </div>
            )}
            <div className="flex justify-between mb-2">
              <span className="text-stone-500">
                {hasFundsApplied ? 'Card Payment:' : 'Amount Applied:'}
              </span>
              <span className="font-medium">{formatDollars(isFundsPayment ? paymentResult.amount : creditedAmount)}</span>
            </div>
            {hasFundsApplied && (
              <div className="flex justify-between mb-2 pt-1 border-t border-stone-200">
                <span className="text-stone-500 font-medium">Total Applied:</span>
                <span className="font-bold">{formatDollars(totalApplied)}</span>
              </div>
            )}
            <div className="flex justify-between mb-2">
              <span className="text-stone-500">For:</span>
              <span className="font-medium">{linkData?.scoutName}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-stone-500">Method:</span>
              <span className="font-medium">
                {isFundsPayment
                  ? 'Scout Funds'
                  : hasFundsApplied
                    ? 'Scout Funds + Card'
                    : 'Card'}
              </span>
            </div>
            {remainingBalance > 0 && (
              <div className="flex justify-between pt-2 border-t border-stone-200">
                <span className="text-stone-500">Remaining Balance:</span>
                <span className="font-medium text-amber-600">{formatDollars(remainingBalance)}</span>
              </div>
            )}
            {isFundsPayment && paymentResult.remainingCredit !== undefined && paymentResult.remainingCredit > 0 && (
              <div className="flex justify-between pt-2 border-t border-stone-200">
                <span className="text-stone-500">Remaining Scout Funds:</span>
                <span className="font-medium text-forest-600">{formatDollars(paymentResult.remainingCredit)}</span>
              </div>
            )}
          </div>
          {paymentResult.receiptUrl && (
            <a
              href={paymentResult.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-forest-600 hover:text-forest-700 font-medium"
            >
              View Receipt
            </a>
          )}
          {remainingBalance > 0 ? (
            <p className="mt-6 text-sm text-stone-500">
              You can make another payment using this same link.
              <button
                onClick={() => {
                  setPaymentSuccess(false)
                  setPaymentResult(null)
                  // Refresh link data to get updated balance
                  setLoading(true)
                  fetch(`/api/payment-links/${token}`)
                    .then(res => res.json())
                    .then(data => {
                      setLinkData(data)
                      setPaymentAmountInput((data.currentBillingCents / 100).toFixed(2))
                      setIsCustomAmount(false)
                    })
                    .finally(() => setLoading(false))
                }}
                className="block mt-2 text-forest-600 hover:text-forest-700 font-medium"
              >
                Make Another Payment
              </button>
            </p>
          ) : (
            <p className="mt-6 text-sm text-stone-500">
              {paymentResult.chargeMarkedPaid
                ? 'This charge has been marked as paid. You can close this window.'
                : 'Your balance is now paid in full. You can close this window.'}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!linkData) {
    return null
  }

  // Zero balance state
  if (linkData.currentBillingCents <= 0) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-stone-900 mb-2">No Balance Due</h1>
          <p className="text-stone-600">
            {linkData.scoutName}&apos;s account is up to date. No payment is needed at this time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {linkData.unitLogoUrl && (
            <Image
              src={linkData.unitLogoUrl}
              alt={`${linkData.unitName} logo`}
              width={80}
              height={80}
              className="h-20 w-auto mx-auto mb-4 object-contain"
              unoptimized
            />
          )}
          <h1 className="text-2xl font-bold text-stone-900">{linkData.unitName}</h1>
          <p className="text-stone-600">Secure Payment</p>
        </div>

        {/* Payment Card */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Balance Header */}
          <div className="bg-green-800 text-white p-6 text-center">
            <p className="text-sm opacity-90 mb-1">Amount Due</p>
            <p className="text-4xl font-bold">{formatCurrency(linkData.currentBillingCents)}</p>
            <p className="text-sm opacity-75 mt-1">for {linkData.scoutName}</p>
          </div>

          {/* Details */}
          <div className="p-6 border-b border-stone-200">
            <div className="space-y-3">
              {linkData.description && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Description:</span>
                  <span className="text-stone-900 text-right max-w-[200px]">
                    {linkData.description}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-stone-100">
                <a
                  href={`/login?redirect=/finances/accounts/${linkData.scoutAccountId}`}
                  className="text-sm text-forest-600 hover:text-forest-700 flex items-center justify-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  View full account details in ChuckBox
                </a>
              </div>
            </div>
          </div>

          {/* Scout Funds Section */}
          {linkData.availableFundsCents > 0 && fundsCalculation && (
            <div className="p-6 border-b border-stone-200">
              {/* Funds Balance Display */}
              <div className="bg-forest-50 border border-forest-200 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-forest-700">Scout Funds Available</p>
                    <p className="text-2xl font-bold text-forest-800">
                      {formatCurrency(fundsCalculation.availableFunds)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-forest-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-forest-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Use Funds Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={useScoutFunds}
                  onChange={(e) => {
                    setUseScoutFunds(e.target.checked)
                    // If turning on funds and it covers all, clear card amount
                    if (e.target.checked && fundsCalculation.fundsCoversAll) {
                      setPaymentAmountInput('0')
                    } else if (e.target.checked) {
                      // Set card amount to remaining after funds
                      setPaymentAmountInput((fundsCalculation.remainingAfterFunds / 100).toFixed(2))
                    } else {
                      // Reset to full amount when turning off funds
                      setPaymentAmountInput((fundsCalculation.amountDue / 100).toFixed(2))
                    }
                  }}
                  disabled={isProcessing || isProcessingBalance}
                  className="checkbox-native mt-1 h-5 w-5"
                />
                <div className="flex-1">
                  <p className="font-medium text-stone-900 group-hover:text-forest-700">
                    Use Scout Funds toward this payment
                  </p>
                  <p className="text-sm text-stone-500">
                    Apply {formatCurrency(fundsCalculation.fundsToApply)} from {linkData.scoutName}&apos;s Scout Funds
                  </p>
                </div>
              </label>

              {/* Funds Application Breakdown */}
              {useScoutFunds && (
                <div className="mt-4 bg-stone-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Amount Due:</span>
                    <span className="text-stone-900">{formatCurrency(fundsCalculation.amountDue)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Scout Funds Applied:</span>
                    <span className="text-forest-600 font-medium">-{formatCurrency(fundsCalculation.fundsToApply)}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-stone-200">
                    <span className="font-medium text-stone-900">
                      {fundsCalculation.fundsCoversAll ? 'Total Due:' : 'Remaining to Pay:'}
                    </span>
                    <span className="font-bold text-stone-900">
                      {formatCurrency(fundsCalculation.remainingAfterFunds)}
                    </span>
                  </div>
                </div>
              )}

              {/* Pay with Funds Only Button (if funds cover full amount) */}
              {useScoutFunds && fundsCalculation.fundsCoversAll && (
                <Button
                  onClick={() => handlePayWithBalance(fundsCalculation.fundsToApply)}
                  disabled={isProcessingBalance || isProcessing}
                  className="w-full mt-4 bg-green-800 hover:bg-green-900"
                >
                  {isProcessingBalance
                    ? 'Processing...'
                    : `Pay ${formatCurrency(fundsCalculation.amountDue)} with Scout Funds`}
                </Button>
              )}
            </div>
          )}

          {/* Divider - show if partial funds or no funds being used */}
          {linkData.squareEnabled && linkData.currentBillingCents > 0 && (
            (!useScoutFunds || (useScoutFunds && fundsCalculation && !fundsCalculation.fundsCoversAll)) && (
              <div className="px-6 py-2">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-stone-300" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-3 text-stone-500">
                      {useScoutFunds && fundsCalculation && !fundsCalculation.fundsCoversAll
                        ? 'Pay remaining with card'
                        : 'Pay with card'}
                    </span>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Payment Form - hide if funds cover full amount */}
          {!(useScoutFunds && fundsCalculation?.fundsCoversAll) && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!linkData.squareEnabled ? (
                <div className="text-center py-8">
                  <p className="text-stone-600">
                    Online payments are not available for this unit.
                  </p>
                  <p className="mt-2 text-sm text-stone-500">
                    Please contact your unit leader for alternative payment options.
                  </p>
                </div>
              ) : (
                <>
                  {/* Amount Input */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-stone-700">
                      {useScoutFunds ? 'Card Payment Amount' : 'Payment Amount'}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={paymentAmountInput}
                        onChange={handleAmountChange}
                        className="w-full pl-7 pr-4 py-3 border border-stone-300 rounded-lg text-lg font-medium focus:ring-2 focus:ring-forest-500 focus:border-forest-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-stone-500">
                        Min: {formatCurrency(MIN_PAYMENT_CENTS)} · Max: {formatCurrency(paymentCalculation?.maxAmountCents || 0)}
                      </span>
                      {isCustomAmount && paymentCalculation && (
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentAmountInput((paymentCalculation.maxAmountCents / 100).toFixed(2))
                            setIsCustomAmount(false)
                          }}
                          className="text-forest-600 hover:text-forest-700 font-medium"
                        >
                          {useScoutFunds ? 'Pay remaining' : 'Pay full balance'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fee Breakdown (if fees are passed to payer) */}
                  {linkData.feesPassedToPayer && paymentCalculation && paymentCalculation.baseAmountCents > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-amber-800 mb-2">Payment Breakdown</p>
                      <div className="space-y-1 text-sm">
                        {useScoutFunds && fundsCalculation && (
                          <div className="flex justify-between text-forest-700">
                            <span>Scout Funds Applied:</span>
                            <span>-{formatCurrency(fundsCalculation.fundsToApply)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-amber-700">Card Payment:</span>
                          <span className="text-amber-900">{formatCurrency(paymentCalculation.baseAmountCents)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-amber-700">Processing Fee:</span>
                          <span className="text-amber-900">{formatCurrency(paymentCalculation.feeAmountCents)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-amber-200">
                          <span className="font-medium text-amber-800">Total Card Charge:</span>
                          <span className="font-medium text-amber-900">{formatCurrency(paymentCalculation.totalAmountCents)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Card Input */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-stone-700">
                      Card Details
                    </label>
                    <div
                      id="card-container"
                      ref={cardContainerRef}
                      className={`min-h-[50px] rounded-md border border-stone-300 bg-white p-3 ${
                        cardLoading ? 'animate-pulse bg-stone-100' : ''
                      }`}
                    >
                      {cardLoading && (
                        <div className="text-sm text-stone-500">Loading payment form...</div>
                      )}
                    </div>
                    <p className="text-xs text-stone-500">
                      Your payment is processed securely by Square.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={cardLoading || isProcessing || !paymentCalculation?.isValid}
                    className="w-full bg-green-800 hover:bg-green-900 text-white py-3 text-lg"
                  >
                    {isProcessing
                      ? 'Processing...'
                      : `Pay ${formatCurrency(paymentCalculation?.totalAmountCents || 0)} with Card`}
                  </Button>
                </>
              )}
            </form>
          )}

          {/* Footer */}
          <div className="bg-stone-50 px-6 py-4 text-center text-xs text-stone-500">
            Powered by ChuckBox
          </div>
        </div>

        {/* Expiration Notice */}
        <p className="text-center text-sm text-stone-500 mt-4">
          This payment link expires on{' '}
          {new Date(linkData.expiresAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>
    </div>
  )
}
