'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import { adjustScoutFunds } from '@/app/actions/funds'
import { AlertCircle, CheckCircle2, Plus } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance?: number
  } | null
}

interface FundraiserType {
  id: string
  name: string
  description: string | null
}

interface AddFundsFormProps {
  // Required
  unitId: string
  scouts: Scout[]
  fundraiserTypes: FundraiserType[]

  // Single-scout mode (account detail page)
  scoutAccountId?: string
  scoutName?: string
  currentFundsBalance?: number

  // Callbacks
  onSuccess?: () => void
  onCancel?: () => void
}

export function AddFundsForm({
  unitId,
  scouts,
  fundraiserTypes,
  scoutAccountId,
  scoutName,
  currentFundsBalance,
  onSuccess,
  onCancel,
}: AddFundsFormProps) {
  const router = useRouter()

  // Form state
  const [selectedScoutId, setSelectedScoutId] = useState(scoutAccountId ? '' : '')
  const [amount, setAmount] = useState('')
  const [fundraiserTypeId, setFundraiserTypeId] = useState('')
  const [notes, setNotes] = useState('')

  // UI state
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Determine mode
  const isSingleScoutMode = !!scoutAccountId

  // Get selected scout info
  const selectedScout = isSingleScoutMode
    ? {
        id: '',
        first_name: scoutName?.split(' ')[0] || '',
        last_name: scoutName?.split(' ').slice(1).join(' ') || '',
        scout_accounts: {
          id: scoutAccountId!,
          billing_balance: 0,
          funds_balance: currentFundsBalance || 0,
        },
      }
    : scouts?.find((s) => s.id === selectedScoutId)

  const scoutAccount = isSingleScoutMode
    ? { id: scoutAccountId!, funds_balance: currentFundsBalance || 0 }
    : selectedScout?.scout_accounts

  // Validation - fundraiser type is optional
  const parsedAmount = parseFloat(amount) || 0
  const isValid =
    (isSingleScoutMode || selectedScoutId) &&
    parsedAmount > 0

  const handleSubmit = async () => {
    if (!isValid || !scoutAccount) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await adjustScoutFunds(
        scoutAccount.id,
        parsedAmount,
        'add',
        fundraiserTypeId || undefined,
        notes.trim() || undefined
      )

      if (!result.success) {
        setError(result.error || 'Failed to add funds')
        setIsProcessing(false)
        return
      }

      setSuccess(true)

      // Refresh the page data
      router.refresh()

      // Call success callback
      if (onSuccess) {
        onSuccess()
      }

      // Reset form after a delay
      setTimeout(() => {
        setSuccess(false)
        setAmount('')
        setNotes('')
        if (!isSingleScoutMode) {
          setSelectedScoutId('')
        }
        setFundraiserTypeId('')
        setIsProcessing(false)
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsProcessing(false)
    }
  }

  const handleScoutSelect = (scoutId: string) => {
    setSelectedScoutId(scoutId)
    setError(null)
  }

  if (success) {
    return (
      <div className="text-center py-8 space-y-4">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
        <div>
          <p className="font-medium text-lg">Funds Added Successfully!</p>
          <p className="text-muted-foreground">
            {formatCurrency(parsedAmount)} has been credited to the scout account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Scout Selection (only in multi-scout mode) */}
      {!isSingleScoutMode && (
        <div className="space-y-2">
          <Label htmlFor="scout-select">Scout</Label>
          <select
            id="scout-select"
            required
            disabled={isProcessing}
            className="flex h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50"
            value={selectedScoutId}
            onChange={(e) => handleScoutSelect(e.target.value)}
          >
            <option value="">Select a scout...</option>
            {scouts.map((scout) => (
              <option key={scout.id} value={scout.id}>
                {scout.first_name} {scout.last_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Current Funds Balance */}
      {scoutAccount && 'funds_balance' in scoutAccount && (
        <div className="rounded-lg bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">Current Scout Funds Balance</p>
          <p className="text-2xl font-semibold text-green-600">
            {formatCurrency(scoutAccount.funds_balance || 0)}
          </p>
        </div>
      )}

      {/* Amount */}
      <div className="space-y-2">
        <Label htmlFor="amount">Amount</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pl-7"
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Fundraiser Type - only show if types exist */}
      {fundraiserTypes.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="fundraiser-type">Fundraiser Type (optional)</Label>
          <Select
            value={fundraiserTypeId}
            onValueChange={setFundraiserTypeId}
            disabled={isProcessing}
          >
            <SelectTrigger id="fundraiser-type">
              <SelectValue placeholder="Select fundraiser type" />
            </SelectTrigger>
            <SelectContent>
              {fundraiserTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                  {type.description && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      - {type.description}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          placeholder="e.g., Wreath order #123, 5 wreaths sold"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          disabled={isProcessing}
        />
      </div>

      {/* Summary */}
      {parsedAmount > 0 && (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount to Credit</span>
            <span className="font-medium">{formatCurrency(parsedAmount)}</span>
          </div>
          {scoutAccount && 'funds_balance' in scoutAccount && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>New Funds Balance</span>
              <span className="text-green-600">
                {formatCurrency((scoutAccount.funds_balance || 0) + parsedAmount)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onCancel && (
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1"
          >
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isProcessing}
          className="flex-1"
        >
          {isProcessing ? (
            'Adding Funds...'
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              Add Funds
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
