'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency } from '@/lib/utils'
import { SQUARE_FEE_PERCENT, SQUARE_FEE_FIXED_DOLLARS } from '@/lib/billing'
import { PAYMENT_METHODS } from '@/lib/constants'
import { trackPaymentInitiated, trackPaymentCompleted, trackPaymentFailed } from '@/lib/analytics'
import { createLogger } from '@/lib/logger'
import { ScoutSelector, SelectedScoutDisplay } from './scout-selector'
import { PaymentSummary } from './payment-summary'
import type { SquareCard } from '@/types/square'
import { CreditCard, Banknote } from 'lucide-react'

const log = createLogger('PaymentEntry')

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
  } | null
}

interface PaymentEntryProps {
  // Required
  unitId: string
  applicationId: string
  locationId: string | null
  environment: 'sandbox' | 'production'

  // Multi-scout mode (payments page)
  scouts?: Scout[]

  // Single-scout mode (account detail page)
  scoutAccountId?: string
  scoutName?: string
  currentBalance?: number

  // Callbacks
  onPaymentComplete?: () => void
}

export function PaymentEntry({
  unitId,
  applicationId,
  locationId,
  environment,
  scouts,
  scoutAccountId,
  scoutName,
  currentBalance: initialBalance,
  onPaymentComplete,
}: PaymentEntryProps) {
  const router = useRouter()
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)
  const initAttemptRef = useRef(0)
  const initInProgressRef = useRef(false)

  // Form state
  const [activeTab, setActiveTab] = useState<string>(locationId ? 'card' : 'manual')
  const [selectedScoutId, setSelectedScoutId] = useState(scoutAccountId ? '' : '')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [reference, setReference] = useState('')

  // UI state
  const [isCardLoading, setIsCardLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  const [cardInitialized, setCardInitialized] = useState(false)

  // Determine mode
  const isSingleScoutMode = !!scoutAccountId
  const isSquareConnected = !!locationId

  // Filter scouts to only those with billing balance (owing money)
  const scoutsWithBalance = scouts?.filter((scout) => {
    const balance = scout.scout_accounts?.billing_balance || 0
    return balance < 0 // Only show scouts who owe money
  }) || []

  // Get selected scout info
  const selectedScout = isSingleScoutMode
    ? { id: '', first_name: scoutName?.split(' ')[0] || '', last_name: scoutName?.split(' ').slice(1).join(' ') || '', scout_accounts: { id: scoutAccountId!, billing_balance: initialBalance || 0 } }
    : scouts?.find((s) => s.id === selectedScoutId)

  const scoutAccount = isSingleScoutMode
    ? { id: scoutAccountId!, billing_balance: initialBalance || 0 }
    : selectedScout?.scout_accounts

  const currentBalance = scoutAccount?.billing_balance || 0

  // Calculate amounts
  const parsedAmount = parseFloat(amount) || 0
  const isCardPayment = activeTab === 'card'
  const isManualCard = activeTab === 'manual' && paymentMethod === 'card'
  const showFees = isCardPayment || isManualCard
  const feeAmount = showFees ? parsedAmount * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_DOLLARS : 0
  const netAmount = parsedAmount - feeAmount

  // Load Square Web Payments SDK
  useEffect(() => {
    if (!isSquareConnected) return

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
  }, [environment, isSquareConnected])

  // Initialize card payment form with mobile-friendly retry logic
  const initializeCard = useCallback(async () => {
    // Prevent concurrent initialization attempts
    if (initInProgressRef.current) {
      log.debug('initializeCard skipped - already in progress')
      return
    }

    // Skip if already initialized
    if (cardRef.current) {
      log.debug('initializeCard skipped - card already exists')
      setCardInitialized(true)
      setIsCardLoading(false)
      return
    }

    log.debug('initializeCard called', {
      hasSquare: !!window.Square,
      hasContainer: !!cardContainerRef.current,
      locationId,
      applicationId,
      attempt: initAttemptRef.current,
    })

    if (!window.Square) {
      log.error('Square SDK not loaded')
      setError('Payment system not available. Please refresh the page.')
      return
    }

    if (!cardContainerRef.current) {
      log.error('Card container ref not available')
      return
    }

    if (!locationId || !applicationId) {
      log.error('Missing locationId or applicationId')
      setError('Payment configuration error. Please contact support.')
      return
    }

    // Check container has dimensions (mobile fix)
    const container = cardContainerRef.current
    const rect = container.getBoundingClientRect()
    log.debug('Container dimensions', { width: rect.width, height: rect.height })

    if (rect.width === 0 || rect.height === 0) {
      // Container not ready, retry
      if (initAttemptRef.current < 10) {
        initAttemptRef.current++
        setTimeout(() => initializeCard(), 100)
      } else {
        setError('Unable to display payment form. Please refresh the page.')
      }
      return
    }

    // Mark initialization as in progress
    initInProgressRef.current = true

    try {
      setIsCardLoading(true)
      setError(null)

      log.debug('Creating Square payments instance')
      const payments = await window.Square.payments(applicationId, locationId)

      log.debug('Creating card')
      const card = await payments.card()

      log.debug('Attaching card to container element')
      await card.attach(container)

      log.debug('Card initialized successfully')
      cardRef.current = card
      setCardInitialized(true)
      setIsCardLoading(false)
      initAttemptRef.current = 0
    } catch (err) {
      log.error('Failed to initialize Square card', err)

      // Retry on failure (mobile can be slow)
      if (initAttemptRef.current < 3) {
        initAttemptRef.current++
        initInProgressRef.current = false
        setTimeout(() => initializeCard(), 500)
        return
      }

      setError('Failed to initialize payment form. Please refresh and try again.')
      setIsCardLoading(false)
    } finally {
      initInProgressRef.current = false
    }
  }, [applicationId, locationId])

  // Initialize card when tab becomes active, SDK is ready, and container is visible
  useEffect(() => {
    if (activeTab !== 'card' || !sdkReady || cardInitialized || !isSquareConnected) {
      return
    }

    log.debug('Triggering card initialization', { activeTab, sdkReady, cardInitialized, isSquareConnected })
    setIsCardLoading(true)

    let cancelled = false

    const doInit = () => {
      if (!cancelled) {
        initializeCard()
      }
    }

    // Use IntersectionObserver to wait for container to be visible (better for mobile/animations)
    if (cardContainerRef.current && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (entry && entry.isIntersecting && entry.intersectionRatio > 0) {
            log.debug('Container is visible, initializing card')
            observer.disconnect()
            setTimeout(doInit, 100)
          }
        },
        { threshold: 0.1 }
      )
      observer.observe(cardContainerRef.current)

      // Fallback: try anyway after 500ms if observer doesn't fire
      const fallbackTimer = setTimeout(() => {
        log.debug('Fallback initialization after timeout')
        observer.disconnect()
        doInit()
      }, 500)

      return () => {
        cancelled = true
        observer.disconnect()
        clearTimeout(fallbackTimer)
      }
    } else {
      // Fallback for browsers without IntersectionObserver
      const timer = setTimeout(doInit, 100)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
  }, [activeTab, sdkReady, cardInitialized, isSquareConnected, initializeCard])

  // Cleanup card when leaving card tab and reset initialized state
  useEffect(() => {
    if (activeTab !== 'card' && cardRef.current) {
      log.debug('Leaving card tab, destroying card')
      cardRef.current.destroy().catch((err) => log.error('Error destroying card', err))
      cardRef.current = null
      setCardInitialized(false)
    }
  }, [activeTab])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cardRef.current) {
        log.debug('Unmounting, destroying card')
        cardRef.current.destroy().catch((err) => log.error('Error destroying card on unmount', err))
        cardRef.current = null
      }
    }
  }, [])

  // Handle card payment
  const handleCardPayment = async () => {
    if (!cardRef.current) {
      setError('Payment form not ready')
      return
    }

    if (!scoutAccount) {
      setError('Please select a scout')
      return
    }

    if (parsedAmount < 1) {
      setError('Minimum payment amount is $1.00')
      return
    }

    setIsProcessing(true)
    setError(null)

    trackPaymentInitiated({
      amount: parsedAmount,
      scoutAccountId: scoutAccount.id,
      method: 'card',
    })

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoutAccountId: scoutAccount.id,
          amountCents: Math.round(parsedAmount * 100),
          sourceId: tokenResult.token,
          description: `Payment for ${selectedScout?.first_name} ${selectedScout?.last_name}`,
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
        scoutAccountId: scoutAccount.id,
        method: 'card',
      })

      handleSuccess()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment failed'
      setError(errorMessage)

      trackPaymentFailed({
        amount: parsedAmount,
        errorType: errorMessage,
        scoutAccountId: scoutAccount?.id,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle manual payment
  const handleManualPayment = async () => {
    if (!scoutAccount) {
      setError('Please select a scout')
      return
    }

    if (parsedAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setIsProcessing(true)
    setError(null)

    const supabase = createClient()

    try {
      const paymentDate = new Date().toISOString().split('T')[0]
      const scoutFullName = `${selectedScout?.first_name} ${selectedScout?.last_name}`

      // Create journal entry
      const { data: journalEntry, error: journalError } = await supabase
        .from('journal_entries')
        .insert({
          unit_id: unitId,
          entry_date: paymentDate,
          description: `Payment from ${scoutFullName}`,
          entry_type: 'payment',
          reference: reference || null,
          is_posted: true,
        })
        .select()
        .single()

      if (journalError || !journalEntry) {
        throw journalError || new Error('Failed to create journal entry')
      }

      // Get accounts
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('id, code')
        .eq('unit_id', unitId)
        .in('code', ['1000', '1200', '5600'])

      const accounts = accountsData || []
      const bankAccount = accounts.find((a) => a.code === '1000')
      const receivableAccount = accounts.find((a) => a.code === '1200')
      const feeAccount = accounts.find((a) => a.code === '5600')

      if (!bankAccount || !receivableAccount) {
        throw new Error('Required accounts not found')
      }

      // Create journal lines
      const journalLines = [
        {
          journal_entry_id: journalEntry.id,
          account_id: bankAccount.id,
          scout_account_id: null,
          debit: netAmount,
          credit: 0,
          memo: `${paymentMethod} payment from ${scoutFullName}`,
        },
        {
          journal_entry_id: journalEntry.id,
          account_id: receivableAccount.id,
          scout_account_id: scoutAccount.id,
          debit: 0,
          credit: parsedAmount,
          memo: 'Payment received',
        },
      ]

      if (isManualCard && feeAccount && feeAmount > 0) {
        journalLines.push({
          journal_entry_id: journalEntry.id,
          account_id: feeAccount.id,
          scout_account_id: null,
          debit: feeAmount,
          credit: 0,
          memo: 'Card processing fee',
        })
      }

      const { error: linesError } = await supabase.from('journal_lines').insert(journalLines)
      if (linesError) throw linesError

      // Create payment record
      const { error: paymentError } = await supabase.from('payments').insert({
        unit_id: unitId,
        scout_account_id: scoutAccount.id,
        amount: parsedAmount,
        fee_amount: isManualCard ? feeAmount : 0,
        net_amount: isManualCard ? netAmount : parsedAmount,
        payment_method: paymentMethod,
        status: 'completed',
        journal_entry_id: journalEntry.id,
        notes: notes || null,
      })

      if (paymentError) throw paymentError

      handleSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSuccess = () => {
    setSuccess(true)
    setAmount('')
    setNotes('')
    setReference('')
    if (!isSingleScoutMode) {
      setSelectedScoutId('')
    }

    if (onPaymentComplete) {
      onPaymentComplete()
    }

    // Refresh the page after a short delay to show updated balance
    // The refresh will unmount this component, which will clean up the card properly
    setTimeout(() => {
      router.refresh()
    }, 2000)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (activeTab === 'card') {
      await handleCardPayment()
    } else {
      await handleManualPayment()
    }
  }

  const handlePayFullBalance = () => {
    if (currentBalance < 0) {
      setAmount(Math.abs(currentBalance).toFixed(2))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Tab Selection - only show if Square is connected */}
      {isSquareConnected && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="card" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Card Payment
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Manual Entry
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Scout Selection (multi-scout mode only) */}
      {!isSingleScoutMode && scouts && (
        scoutsWithBalance.length > 0 ? (
          <ScoutSelector
            scouts={scoutsWithBalance}
            selectedScoutId={selectedScoutId}
            onSelect={setSelectedScoutId}
            disabled={isProcessing}
          />
        ) : (
          <div className="rounded-lg bg-stone-50 p-4 text-center">
            <p className="text-stone-600">
              No scouts have outstanding charges.
            </p>
            <p className="text-sm text-stone-500 mt-1">
              Use the &ldquo;Add Funds&rdquo; tab to credit scout accounts for fundraising.
            </p>
          </div>
        )
      )}

      {/* Current Balance Display */}
      {(selectedScout || isSingleScoutMode) && (
        <SelectedScoutDisplay
          scoutName={isSingleScoutMode ? scoutName || '' : `${selectedScout?.first_name} ${selectedScout?.last_name}`}
          currentBalance={currentBalance}
          onPayFullBalance={currentBalance < 0 ? handlePayFullBalance : undefined}
        />
      )}

      {/* Amount Input */}
      <div className="space-y-2">
        <Label htmlFor="amount">Amount *</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min={activeTab === 'card' ? '1' : '0'}
            required
            disabled={isProcessing}
            className="pl-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
        </div>
        {activeTab === 'card' && (
          <p className="text-xs text-stone-500">Minimum payment: $1.00</p>
        )}
      </div>

      {/* Card Payment Tab Content */}
      {activeTab === 'card' && isSquareConnected && (
        <div className="space-y-2">
          <Label>Card Details *</Label>
          {error && !cardInitialized ? (
            <div className="rounded-md border border-error bg-error-light p-4">
              <p className="text-sm text-error">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setError(null)
                  setCardInitialized(false)
                  initAttemptRef.current = 0
                  setTimeout(() => initializeCard(), 100)
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div
              id="card-container"
              ref={cardContainerRef}
              className={`min-h-[56px] rounded-md border border-stone-300 bg-white p-3 ${
                isCardLoading ? 'animate-pulse bg-stone-100' : ''
              } ${cardInitialized ? '' : 'flex items-center justify-center'}`}
            >
              {!cardInitialized && (
                <div className="text-sm text-stone-500">
                  {isCardLoading ? 'Loading payment form...' : 'Initializing...'}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-stone-500">
            Payments are processed securely by Square. Card details never touch our servers.
          </p>
        </div>
      )}

      {/* Manual Entry Tab Content */}
      {(activeTab === 'manual' || !isSquareConnected) && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="method">Payment Method *</Label>
              <select
                id="method"
                required
                disabled={isProcessing}
                className="flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference">Reference #</Label>
              <Input
                id="reference"
                disabled={isProcessing}
                placeholder="Check number, receipt #, etc."
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              disabled={isProcessing}
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </>
      )}

      {/* Payment Summary */}
      <PaymentSummary
        amount={parsedAmount}
        showFees={showFees}
        feeAmount={feeAmount}
        netAmount={netAmount}
        currentBalance={currentBalance}
        showNewBalance={!!(selectedScout || isSingleScoutMode)}
      />

      {/* Error/Success Messages */}
      {error && (
        <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-success-light p-3 text-sm font-medium text-success">
          Payment {activeTab === 'card' ? 'processed' : 'recorded'} successfully! Refreshing...
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={
          isProcessing ||
          (activeTab === 'card' && isCardLoading) ||
          (!isSingleScoutMode && !selectedScoutId) ||
          parsedAmount < (activeTab === 'card' ? 1 : 0.01)
        }
        className="w-full"
      >
        {isProcessing
          ? 'Processing...'
          : activeTab === 'card' && isCardLoading
            ? 'Loading...'
            : activeTab === 'card'
              ? `Pay ${parsedAmount > 0 ? formatCurrency(parsedAmount) : ''}`
              : 'Record Payment'}
      </Button>
    </form>
  )
}
