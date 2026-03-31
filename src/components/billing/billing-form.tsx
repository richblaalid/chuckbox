'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleButtonGroup } from '@/components/ui/toggle-button-group'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import { trackBillingCreated } from '@/lib/analytics'
import { validateLineItems, validateDeposit } from '@/lib/billing-validation'
import type { LineItem } from '@/lib/billing-validation'
import { Plus, X } from 'lucide-react'

const BILLING_TYPE_KEY = 'chuckbox:billing:lastType'

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string } | null
  patrols: { name: string } | null
}

interface BillingFormProps {
  unitId: string
  scouts: Scout[]
  /** Pre-select specific scouts by ID */
  preselectedScoutIds?: string[]
  /** Callback when billing is successfully created */
  onSuccess?: () => void
}

type BillingType = 'split' | 'fixed'

export function BillingForm({ unitId, scouts, preselectedScoutIds, onSuccess }: BillingFormProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedScouts, setSelectedScouts] = useState<Set<string>>(
    () => new Set(preselectedScoutIds || [])
  )
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('fixed')
  const [sendNotifications, setSendNotifications] = useState(false)
  const [scoutSearch, setScoutSearch] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [showLineItems, setShowLineItems] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositDueDate, setDepositDueDate] = useState('')

  // Load saved billing type preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(BILLING_TYPE_KEY)
    if (saved === 'split' || saved === 'fixed') {
      setBillingType(saved)
    }
  }, [])

  // Handle billing type change and save preference
  const handleBillingTypeChange = useCallback((newType: BillingType) => {
    setBillingType(newType)
    localStorage.setItem(BILLING_TYPE_KEY, newType)
  }, [])

  const parsedAmount = parseFloat(amount) || 0

  // Keyboard shortcut: Cmd/Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        // Only submit if form is valid
        if (selectedScouts.size > 0 && parsedAmount > 0 && !isLoading) {
          e.preventDefault()
          const form = document.querySelector('form') as HTMLFormElement | null
          form?.requestSubmit()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedScouts.size, parsedAmount, isLoading])

  // Calculate per-scout and total based on billing type
  const perScoutAmount = billingType === 'split'
    ? (selectedScouts.size > 0 ? parsedAmount / selectedScouts.size : 0)
    : parsedAmount

  const totalAmount = billingType === 'split'
    ? parsedAmount
    : parsedAmount * selectedScouts.size

  const toggleScout = (scoutId: string) => {
    const newSelected = new Set(selectedScouts)
    if (newSelected.has(scoutId)) {
      newSelected.delete(scoutId)
    } else {
      newSelected.add(scoutId)
    }
    setSelectedScouts(newSelected)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (selectedScouts.size === 0) {
      setError('Please select at least one scout')
      setIsLoading(false)
      return
    }

    if (parsedAmount <= 0) {
      setError('Please enter a valid amount')
      setIsLoading(false)
      return
    }

    // Validate line items if shown
    if (showLineItems && lineItems.length > 0) {
      const lineItemError = validateLineItems(lineItems, parsedAmount)
      if (lineItemError) {
        setError(lineItemError)
        setIsLoading(false)
        return
      }
    }

    // Validate deposit if shown
    if (showDeposit) {
      const depositError = validateDeposit(depositAmount, depositDueDate, parsedAmount)
      if (depositError) {
        setError(depositError)
        setIsLoading(false)
        return
      }
    }

    const supabase = createClient()

    try {
      // Get the scout account IDs for selected scouts
      const selectedScoutAccounts = scouts
        .filter((s) => selectedScouts.has(s.id))
        .map((s) => ({
          scoutId: s.id,
          accountId: s.scout_accounts?.id,
          scoutName: `${s.first_name} ${s.last_name}`,
        }))

      // Check all scouts have accounts
      const missingAccounts = selectedScoutAccounts.filter((s) => !s.accountId)
      if (missingAccounts.length > 0) {
        setError(`Some scouts don't have accounts: ${missingAccounts.map((s) => s.scoutName).join(', ')}`)
        setIsLoading(false)
        return
      }

      const billingDate = new Date().toISOString().split('T')[0]

      // Call the atomic billing function - all operations happen in a single transaction
      const { data, error: rpcError } = await supabase.rpc('create_billing_with_journal', {
        p_unit_id: unitId,
        p_description: description,
        p_total_amount: totalAmount,
        p_billing_date: billingDate,
        p_billing_type: billingType,
        p_per_scout_amount: perScoutAmount,
        p_scout_accounts: selectedScoutAccounts,
      })

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      const result = data as { success: boolean; billing_record_id: string; journal_entry_id: string } | null
      if (!result?.success) {
        throw new Error('Failed to create billing record')
      }

      // Persist line items and deposit fields if provided
      if ((showLineItems && lineItems.length > 0) || (showDeposit && depositAmount)) {
        const { error: updateError } = await supabase
          .from('billing_records')
          .update({
            line_items: showLineItems && lineItems.length > 0
              ? lineItems.map((li) => ({ description: li.description, amount: li.amount }))
              : null,
            deposit_amount: showDeposit && depositAmount ? parseFloat(depositAmount) : null,
            deposit_due_date: showDeposit && depositDueDate ? depositDueDate : null,
          })
          .eq('id', result.billing_record_id)

        if (updateError) {
          console.error('Failed to save line items/deposit:', updateError)
          // Don't fail the whole operation - billing record was created successfully
        }
      }

      // Track billing event
      trackBillingCreated({
        total: totalAmount,
        scoutCount: selectedScouts.size,
        perScout: perScoutAmount,
        billingType,
      })

      // Send notifications if checkbox was checked
      if (sendNotifications && result.billing_record_id) {
        try {
          await fetch(`/api/billing-records/${result.billing_record_id}/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
        } catch (notifyError) {
          console.error('Failed to send notifications:', notifyError)
          // Don't fail the whole operation if notifications fail
        }
      }

      addToast({
        variant: 'success',
        title: 'Billing created',
        description: `${formatCurrency(totalAmount)} charged to ${selectedScouts.size} scout${selectedScouts.size !== 1 ? 's' : ''}`,
      })
      setAmount('')
      setDescription('')
      setSelectedScouts(new Set())
      setSendNotifications(false)
      setLineItems([])
      setShowLineItems(false)
      setShowDeposit(false)
      setDepositAmount('')
      setDepositDueDate('')

      // Call onSuccess callback or refresh
      if (onSuccess) {
        setTimeout(() => {
          onSuccess()
        }, 1500)
      } else {
        // Refresh server components to show new record
        setTimeout(() => {
          router.refresh()
        }, 1500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Filter scouts by search
  const filteredScouts = useMemo(() => {
    if (!scoutSearch) return scouts
    const query = scoutSearch.toLowerCase()
    return scouts.filter((s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(query)
    )
  }, [scouts, scoutSearch])

  const filteredScoutIds = useMemo(() => new Set(filteredScouts.map((s) => s.id)), [filteredScouts])

  // Group scouts by patrol (using all scouts for group structure, filtered for visibility)
  const patrolGroups = scouts.reduce(
    (groups, scout) => {
      const patrol = scout.patrols?.name || 'No Patrol'
      if (!groups[patrol]) {
        groups[patrol] = []
      }
      groups[patrol].push(scout)
      return groups
    },
    {} as Record<string, Scout[]>
  )

  const selectAll = () => {
    const newSelected = new Set(selectedScouts)
    filteredScouts.forEach((s) => newSelected.add(s.id))
    setSelectedScouts(newSelected)
  }

  const selectNone = () => {
    const newSelected = new Set(selectedScouts)
    filteredScouts.forEach((s) => newSelected.delete(s.id))
    setSelectedScouts(newSelected)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-1">
      {/* 1. Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description *</Label>
        <Input
          id="description"
          required
          placeholder={billingType === 'split' ? 'e.g., Summer Camp 2026' : 'e.g., Annual Dues 2026'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* 2. Billing Type Toggle */}
      <div className="space-y-2">
        <Label>Billing Type</Label>
        <div className="ml-4 mt-3">
          <ToggleButtonGroup
            options={[
              { value: 'fixed', label: 'Fixed Amount' },
              { value: 'split', label: 'Split Total' },
            ]}
            value={billingType}
            onChange={handleBillingTypeChange}
            aria-label="Billing type"
          />
        </div>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {billingType === 'split'
            ? 'Enter a total amount to split equally among selected scouts (e.g., camping trip costs)'
            : 'Enter an amount to charge each selected scout (e.g., annual dues)'}
        </p>
      </div>

      {/* 3. Amount */}
      <div className="w-40 space-y-2">
        <Label htmlFor="amount">
          {billingType === 'split' ? 'Total Amount' : 'Per Scout'} *
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 dark:text-stone-400">
            $
          </span>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="pl-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
        </div>
      </div>

      {/* 3b. Line Items (optional) */}
      {!showLineItems ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowLineItems(true)
            setLineItems([{ description: '', amount: 0 }])
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add itemized breakdown
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-4">
          <div className="flex items-center justify-between">
            <Label>Line Items</Label>
            <button
              type="button"
              onClick={() => {
                setShowLineItems(false)
                setLineItems([])
              }}
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              aria-label="Close line items"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {lineItems.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                placeholder="Description"
                value={item.description}
                onChange={(e) => {
                  const updated = [...lineItems]
                  updated[index] = { ...updated[index], description: e.target.value }
                  setLineItems(updated)
                }}
                className="flex-1"
              />
              <div className="relative w-28">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 dark:text-stone-400">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={item.amount || ''}
                  onChange={(e) => {
                    const updated = [...lineItems]
                    updated[index] = { ...updated[index], amount: parseFloat(e.target.value) || 0 }
                    setLineItems(updated)
                  }}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="pl-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setLineItems(lineItems.filter((_, i) => i !== index))
                }}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                aria-label="Remove line item"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add line item
          </Button>
          {lineItems.length > 0 && (
            <p
              className={`text-sm ${
                Math.abs(lineItems.reduce((sum, li) => sum + li.amount, 0) - parsedAmount) > 0.01
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-stone-500 dark:text-stone-400'
              }`}
            >
              Line items total: {formatCurrency(lineItems.reduce((sum, li) => sum + li.amount, 0))}
              {parsedAmount > 0 && ` / ${formatCurrency(parsedAmount)}`}
            </p>
          )}
        </div>
      )}

      {/* 3c. Deposit Requirement (optional) */}
      {!showDeposit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowDeposit(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add deposit requirement
        </Button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-stone-200 dark:border-stone-700 p-4">
          <div className="space-y-1">
            <Label htmlFor="deposit-amount">Deposit Amount</Label>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 dark:text-stone-400">
                $
              </span>
              <Input
                id="deposit-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="pl-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deposit-due-date">Due Date</Label>
            <Input
              id="deposit-due-date"
              type="date"
              value={depositDueDate}
              onChange={(e) => setDepositDueDate(e.target.value)}
              className="w-40"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowDeposit(false)
              setDepositAmount('')
              setDepositDueDate('')
            }}
            className="ml-auto self-start text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
            aria-label="Close deposit"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 4. Scout Selection */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Select Scouts ({selectedScouts.size} selected)</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300"
            >
              Select All
            </button>
            <span className="text-stone-300 dark:text-stone-600">|</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300"
            >
              Clear
            </button>
          </div>
        </div>

        <Input
          placeholder="Search scouts..."
          value={scoutSearch}
          onChange={(e) => setScoutSearch(e.target.value)}
          className="mb-2"
        />

        <div className="max-h-64 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 p-4">
          {Object.entries(patrolGroups).map(([patrol, patrolScouts]) => {
            const visiblePatrolScouts = patrolScouts.filter((s) => filteredScoutIds.has(s.id))
            if (visiblePatrolScouts.length === 0) return null

            const allSelected = visiblePatrolScouts.every((s) => selectedScouts.has(s.id))
            const someSelected = visiblePatrolScouts.some((s) => selectedScouts.has(s.id))

            return (
              <div key={patrol} className="mb-4 last:mb-0">
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => {
                      const newSelected = new Set(selectedScouts)
                      visiblePatrolScouts.forEach((s) => {
                        if (checked) newSelected.add(s.id)
                        else newSelected.delete(s.id)
                      })
                      setSelectedScouts(newSelected)
                    }}
                  />
                  <span className="text-sm font-medium text-stone-700 dark:text-stone-400">
                    {patrol}
                  </span>
                </label>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {visiblePatrolScouts.map((scout) => (
                    <label
                      key={scout.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 transition-colors ${
                        selectedScouts.has(scout.id)
                          ? 'border-forest-600 bg-forest-50 dark:border-forest-500 dark:bg-forest-900/30'
                          : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScouts.has(scout.id)}
                        onChange={() => toggleScout(scout.id)}
                        className="checkbox-native"
                      />
                      <span className="text-sm text-stone-700 dark:text-stone-200">
                        {scout.first_name} {scout.last_name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 5. Cost Preview */}
      {selectedScouts.size > 0 && parsedAmount > 0 && (
        <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3 text-sm">
          {billingType === 'fixed' ? (
            <span className="text-stone-700 dark:text-stone-200">
              {selectedScouts.size} scout{selectedScouts.size !== 1 ? 's' : ''} selected &middot; {formatCurrency(parsedAmount)} each &middot;{' '}
              <strong>Total: {formatCurrency(parsedAmount * selectedScouts.size)}</strong>
            </span>
          ) : (
            <span className="text-stone-700 dark:text-stone-200">
              {selectedScouts.size} scout{selectedScouts.size !== 1 ? 's' : ''} selected &middot; {formatCurrency(parsedAmount)} &divide; {selectedScouts.size} ={' '}
              <strong>{formatCurrency(parsedAmount / selectedScouts.size)}/scout</strong>
            </span>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error-dark">
          {error}
        </div>
      )}
      </div>

      {/* Sticky footer — always visible */}
      <div className="shrink-0 border-t border-stone-200 dark:border-stone-700 pt-4 mt-4 space-y-3">
        {/* 6. Notification Option */}
        {selectedScouts.size > 0 && parsedAmount > 0 && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sendNotifications}
              onChange={(e) => setSendNotifications(e.target.checked)}
              className="checkbox-native mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100">Send payment notifications to parents</span>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Each parent will receive an email with the charge details and a payment link
              </p>
            </div>
          </label>
        )}

        {/* 7. Submit */}
        <Button
          type="submit"
          loading={isLoading}
          loadingText="Creating..."
          disabled={selectedScouts.size === 0 || parsedAmount <= 0}
          className="w-full"
        >
          Create Billing
        </Button>
        <p className="text-xs text-center text-stone-400 dark:text-stone-500">
          ⌘+Enter to submit
        </p>
      </div>
    </form>
  )
}
