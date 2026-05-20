'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { recordQuickPayment } from '@/app/actions/payments'
import { SQUARE_FEE_PERCENT, SQUARE_FEE_FIXED_DOLLARS } from '@/lib/billing'
import { trackPaymentInitiated, trackPaymentCompleted, trackPaymentFailed } from '@/lib/analytics'
import { ChargeAllocationList } from '@/components/payments/charge-allocation-list'
import type { OutstandingCharge, Allocation, RowState, ValidationIssue } from '@/lib/payment-allocation'
import { computeAllocations } from '@/lib/payment-allocation'
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
  /** Pre-fill the amount (e.g., from a billing charge) */
  initialAmount?: number
  /** Pre-select a specific charge in the allocations list */
  initialChargeId?: string
  /** Lock the scout selector (prevent changing) */
  lockedScoutId?: boolean
  onSuccess?: () => void
  onCancel?: () => void
}

const QUICK_AMOUNTS = [10, 20, 50, 100]

type PaymentMethod = 'cash' | 'check' | 'card'

export function QuickPaymentForm({
  unitId,
  scouts,
  squareConfig,
  preselectedScoutId,
  initialAmount,
  initialChargeId,
  lockedScoutId,
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

  // Outstanding charges & allocation state
  const [outstandingCharges, setOutstandingCharges] = useState<OutstandingCharge[]>([])
  const [chargesLoading, setChargesLoading] = useState(false)
  const [chargesLoaded, setChargesLoaded] = useState(false)
  const [rows, setRows] = useState<RowState[]>([])

  // Inline billing creation state (shown when scout has no outstanding charges)
  const [showInlineBilling, setShowInlineBilling] = useState(false)
  const [inlineBillingDescription, setInlineBillingDescription] = useState('')
  const [inlineBillingDate, setInlineBillingDate] = useState(new Date().toISOString().split('T')[0])

  // Funds-first split payment state
  const [fundsToApply, setFundsToApply] = useState('0')
  const parsedFundsToApply = parseFloat(fundsToApply) || 0

  // Square SDK state
  const [sdkReady, setSdkReady] = useState(false)
  const [cardInitialized, setCardInitialized] = useState(false)
  const [isCardLoading, setIsCardLoading] = useState(false)

  const isSquareEnabled = !!squareConfig?.locationId

  // Sort scouts by last name, then first name
  const sortByName = (a: Scout, b: Scout) =>
    a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)

  // Filter to scouts who owe money, sorted by name
  const scoutsOwing = scouts.filter((s) => (s.scout_accounts?.billing_balance || 0) < 0).sort(sortByName)

  const selectedScout = scouts.find((s) => s.id === selectedScoutId)
  const currentBalance = selectedScout?.scout_accounts?.billing_balance || 0
  const fundsBalance = selectedScout?.scout_accounts?.funds_balance || 0
  // Amount = cash/check/card portion to collect (NOT total payment)
  const parsedAmount = parseFloat(amount) || 0

  // Check if scout has funds available to use
  const hasFunds = fundsBalance > 0 && currentBalance < 0
  const maxFromFunds = Math.min(fundsBalance, Math.abs(currentBalance))

  // Total payment = funds applied + amount collected externally
  const totalPayment = parsedAmount + parsedFundsToApply

  // Funds cover everything — no external payment method needed
  const fundsCoverAll = parsedAmount === 0 && parsedFundsToApply > 0

  // Card fees apply to the externally collected portion (parsedAmount)
  const isCardPayment = method === 'card'
  const feeAmount = isCardPayment && parsedAmount > 0
    ? parsedAmount * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_DOLLARS
    : 0
  const netAmount = parsedAmount - feeAmount

  // Calculate new balance after total payment is applied
  const newBalance = currentBalance + totalPayment

  // Engine: compute per-row allocations + validation on every render
  const allocationResult = useMemo(
    () =>
      computeAllocations({
        charges: outstandingCharges,
        rows,
        cash: parsedAmount,
        funds: parsedFundsToApply,
        outstandingBalance: Math.abs(currentBalance),
        cardFeeNet: method === 'card' ? netAmount : undefined,
      }),
    [outstandingCharges, rows, parsedAmount, parsedFundsToApply, currentBalance, method, netAmount]
  )

  const handleRowChange = useCallback((chargeId: string, change: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.chargeId === chargeId ? { ...r, ...change } : r)))
  }, [])

  // Fetch outstanding charges when scout changes
  useEffect(() => {
    if (!selectedScoutId) {
      setOutstandingCharges([])
      setRows([])
      setChargesLoaded(false)
      setFundsToApply('0')
      setShowInlineBilling(false)
      setInlineBillingDescription('')
      setInlineBillingDate(new Date().toISOString().split('T')[0])
      return
    }
    const selectedScoutForCharges = scouts.find((s) => s.id === selectedScoutId)
    const accountId = selectedScoutForCharges?.scout_accounts?.id
    if (!accountId) return

    // Reset funds and inline billing when scout changes
    setFundsToApply('0')
    setShowInlineBilling(false)
    setInlineBillingDescription('')
    setInlineBillingDate(new Date().toISOString().split('T')[0])
    setChargesLoading(true)
    setChargesLoaded(false)

    const fetchCharges = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('billing_charges')
        .select(`
          id,
          amount,
          paid_amount,
          is_paid,
          billing_records!inner (id, description, billing_date, created_at)
        `)
        .eq('scout_account_id', accountId)
        .or('is_void.is.null,is_void.eq.false')

      if (data) {
        const charges = data
          .filter((c) => !c.is_paid && c.amount - (c.paid_amount || 0) > 0)
          .map((c) => ({
            id: c.id,
            billingRecordId: (c.billing_records as Record<string, string>).id,
            description: (c.billing_records as Record<string, string>).description,
            amount: c.amount,
            paidAmount: c.paid_amount || 0,
            billingDate: (c.billing_records as Record<string, string>).billing_date,
            createdAt: (c.billing_records as Record<string, string>).created_at || '',
          }))
        setOutstandingCharges(charges)

        // Initialize rows: one entry per charge; pre-check the initial charge if provided.
        const initialRows: RowState[] = charges.map((c) => ({
          chargeId: c.id,
          checked: initialChargeId === c.id,
          manualAmount: null,
        }))
        setRows(initialRows)
      }
      setChargesLoading(false)
      setChargesLoaded(true)
    }
    fetchCharges()
  }, [selectedScoutId, scouts, initialChargeId])

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
      const cashNeeded = Math.max(0, Math.abs(currentBalance) - parsedFundsToApply)
      setAmount(cashNeeded.toFixed(2))
    }
  }

  const handleCancel = () => {
    // Clear all form state
    setSelectedScoutId(preselectedScoutId || '')
    setAmount('')
    setMethod('cash')
    setReference('')
    setNotes('')
    setFundsToApply('0')
    setOutstandingCharges([])
    setRows([])
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

  const handleFundsTransfer = async (transferAmount: number) => {
    if (!selectedScout?.scout_accounts?.id) return

    const supabase = createClient()

    const { error: rpcError } = await supabase.rpc('transfer_funds_to_billing', {
      p_scout_account_id: selectedScout.scout_accounts.id,
      p_amount: transferAmount,
      p_description: notes || 'Transfer from Scout Funds to pay balance',
    })

    if (rpcError) {
      throw new Error(rpcError.message)
    }
  }

  const handleManualPayment = async (allocationsOverride?: Allocation[]) => {
    if (!selectedScout?.scout_accounts?.id) return

    const paymentMethod = method as 'cash' | 'check'
    const effectiveAllocations = allocationsOverride ?? allocations

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
        allocations: effectiveAllocations.length > 0
          ? effectiveAllocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount }))
          : undefined,
        entryDate: new Date().toLocaleDateString('en-CA'),
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
    if (totalPayment <= 0) {
      setError('Please enter a payment amount')
      return
    }
    if (parsedFundsToApply > fundsBalance) {
      setError(`Insufficient funds. Maximum available: ${formatCurrency(fundsBalance)}`)
      return
    }
    if (parsedFundsToApply > Math.abs(currentBalance)) {
      setError(`Funds amount exceeds balance owed: ${formatCurrency(Math.abs(currentBalance))}`)
      return
    }
    if (method === 'card' && parsedAmount > 0 && parsedAmount < 1) {
      setError('Minimum card payment is $1.00')
      return
    }
    if (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim()) {
      setError('Please create a billing record for this payment')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const scoutAccountId = selectedScout.scout_accounts.id
      let inlineAllocation: Allocation[] | undefined

      // Step 0: Create inline billing record if requested
      if (showInlineBilling && inlineBillingDescription.trim()) {
        const supabase = createClient()
        const { data: billingData, error: billingRpcError } = await supabase.rpc(
          'create_billing_with_journal',
          {
            p_unit_id: unitId,
            p_description: inlineBillingDescription.trim(),
            p_total_amount: totalPayment,
            p_billing_date: inlineBillingDate,
            p_billing_type: 'fixed',
            p_per_scout_amount: totalPayment,
            p_scout_accounts: [{ scoutId: selectedScout.id, accountId: scoutAccountId, scoutName: `${selectedScout.first_name} ${selectedScout.last_name}` }],
          }
        )

        if (billingRpcError) {
          throw new Error(billingRpcError.message)
        }

        const billingResult = billingData as { success: boolean; billing_record_id: string } | null
        if (!billingResult?.success) {
          throw new Error('Failed to create billing record')
        }

        const { data: newCharge } = await supabase
          .from('billing_charges')
          .select('id')
          .eq('billing_record_id', billingResult.billing_record_id)
          .eq('scout_account_id', scoutAccountId)
          .single()

        inlineAllocation = newCharge?.id
          ? [{ chargeId: newCharge.id, amount: totalPayment }]
          : []
      }

      // Step 1: Apply funds transfer if any
      if (parsedFundsToApply > 0) {
        trackPaymentInitiated({
          amount: parsedFundsToApply,
          scoutAccountId,
          method: 'transfer',
        })
        await handleFundsTransfer(parsedFundsToApply)
        trackPaymentCompleted({
          amount: parsedFundsToApply,
          scoutAccountId,
          method: 'transfer',
        })
      }

      // Step 2: Collect external payment (cash/check/card) if any
      if (parsedAmount > 0) {
        if (method === 'card') {
          await handleCardPayment()
        } else {
          await handleManualPayment(inlineAllocation)
        }
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
          {formatCurrency(totalPayment)} from {selectedScout?.first_name} {selectedScout?.last_name}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
      {/* Scout Selector - hide if preselected */}
      {!preselectedScoutId && (
        <div className="space-y-2">
          <Label htmlFor="quick-scout">Scout</Label>
          <select
            id="quick-scout"
            required
            disabled={isSubmitting || lockedScoutId}
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
                  .sort(sortByName)
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

      {/* Outstanding Charges Allocation */}
      {outstandingCharges.length > 0 && (
        <div className="space-y-2">
          <Label>Outstanding Charges</Label>
          <ChargeAllocationList
            charges={outstandingCharges}
            rows={rows}
            result={allocationResult}
            onRowChange={handleRowChange}
          />
        </div>
      )}

      {/* Inline Billing Creation (required when scout has no outstanding charges) */}
      {selectedScoutId && chargesLoaded && outstandingCharges.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-800">
            A billing record is required for this payment.
          </p>
          <p className="text-xs text-amber-700">
            Describe what this payment is for so it can be tracked and reversed if needed.
          </p>
          <div className="space-y-2">
            <Input
              placeholder="Description (e.g., Summer Camp Deposit)"
              value={inlineBillingDescription}
              onChange={(e) => {
                setInlineBillingDescription(e.target.value)
                if (!showInlineBilling) setShowInlineBilling(true)
              }}
              required
            />
            <Input
              type="date"
              value={inlineBillingDate}
              onChange={(e) => setInlineBillingDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Apply Scout Funds (split payment first step) */}
      {hasFunds && (
        <div className="rounded-md border border-stone-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              <Wallet className="mr-1.5 inline h-4 w-4" />
              Apply Scout Funds
            </Label>
            <span className="text-sm text-stone-500">Available: {formatCurrency(fundsBalance)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
              <Input
                type="number"
                value={fundsToApply}
                onChange={(e) => setFundsToApply(e.target.value)}
                className="w-32 pl-7"
                min={0}
                max={maxFromFunds}
                step="0.01"
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFundsToApply(String(maxFromFunds))}
            >
              Apply All
            </Button>
          </div>
          {parsedFundsToApply > 0 && (
            <p className="text-sm text-stone-600">
              Total payment: {formatCurrency(totalPayment)}
              {parsedAmount > 0 && (
                <span className="text-stone-500">
                  {' '}({formatCurrency(parsedFundsToApply)} funds + {formatCurrency(parsedAmount)} {method})
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Amount with Quick Buttons */}
      <div className="space-y-2">
        <Label htmlFor="quick-amount">
          {parsedFundsToApply > 0 ? 'Cash / Check / Card Amount' : 'Amount to Collect'}
        </Label>
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

      {/* Payment Method Toggle - hidden when funds cover full amount */}
      {!fundsCoverAll && (
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
          </div>
        </div>
      )}

      {/* Check Reference (only for check, and not when funds cover all) */}
      {method === 'check' && !fundsCoverAll && (
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
      {method === 'card' && !fundsCoverAll && (
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
      {selectedScout && totalPayment > 0 && currentBalance < 0 && (
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

      </div>

      {/* Sticky footer — always visible */}
      <div className="shrink-0 border-t border-stone-200 dark:border-stone-700 pt-3 mt-3">
        <div className="flex gap-3">
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
              totalPayment <= 0 ||
              (!fundsCoverAll && method === 'card' && !cardInitialized) ||
              (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim())
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : fundsCoverAll ? (
              `Apply Funds (${formatCurrency(parsedFundsToApply)})`
            ) : parsedFundsToApply > 0 ? (
              `Apply ${formatCurrency(parsedFundsToApply)} Funds + Record ${formatCurrency(parsedAmount)}`
            ) : (
              `Record ${formatCurrency(parsedAmount)}`
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
