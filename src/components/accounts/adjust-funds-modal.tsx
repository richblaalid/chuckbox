'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, CheckCircle2, Plus } from 'lucide-react'

interface FundraiserType {
  id: string
  name: string
  description: string | null
}

interface AdjustFundsModalProps {
  scoutAccountId: string
  scoutName: string
  currentFundsBalance: number
  unitId: string
  // Controlled mode (external dialog management)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  onSuccess?: () => void
}

export function AdjustFundsModal({
  scoutAccountId,
  scoutName,
  currentFundsBalance,
  unitId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
  onSuccess,
}: AdjustFundsModalProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [fundraiserTypes, setFundraiserTypes] = useState<FundraiserType[]>([])
  const [loading, setLoading] = useState(false)
  const [direction, setDirection] = useState<'add' | 'remove'>('add')

  // Form state
  const [amount, setAmount] = useState('')
  const [fundraiserTypeId, setFundraiserTypeId] = useState('')
  const [notes, setNotes] = useState('')

  // UI state
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  // Fetch fundraiser types when modal opens
  useEffect(() => {
    if (open && fundraiserTypes.length === 0) {
      const fetchTypes = async () => {
        setLoading(true)
        const supabase = createClient()
        const { data } = await supabase
          .from('fundraiser_types')
          .select('id, name, description')
          .eq('unit_id', unitId)
          .eq('is_active', true)
          .order('name')

        if (data) {
          setFundraiserTypes(data)
        }
        setLoading(false)
      }
      fetchTypes()
    }
  }, [open, unitId, fundraiserTypes.length])

  const parsedAmount = parseFloat(amount) || 0
  const isRemove = direction === 'remove'
  const exceedsBalance = isRemove && parsedAmount > currentFundsBalance
  const notesRequired = isRemove && !notes.trim()
  const isValid = parsedAmount > 0 && !exceedsBalance && (!isRemove || !notesRequired)

  const handleSubmit = async () => {
    if (!isValid) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await adjustScoutFunds(
        scoutAccountId,
        parsedAmount,
        direction,
        fundraiserTypeId || undefined,
        notes.trim() || undefined
      )

      if (!result.success) {
        setError(result.error || 'Failed to adjust funds')
        setIsProcessing(false)
        return
      }

      setSuccess(true)
      router.refresh()

      // Reset and close after delay
      setTimeout(() => {
        setSuccess(false)
        setDirection('add')
        setAmount('')
        setNotes('')
        setFundraiserTypeId('')
        setIsProcessing(false)
        setOpen(false)
        onSuccess?.()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsProcessing(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!isProcessing) {
      setOpen(newOpen)
      if (!newOpen) {
        setDirection('add')
        setAmount('')
        setNotes('')
        setFundraiserTypeId('')
        setError(null)
        setSuccess(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Adjust Funds
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Funds for {scoutName}</DialogTitle>
          <DialogDescription>
            Add or remove funds from this scout&apos;s account
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="text-center py-8 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <div>
              <p className="font-medium text-lg">
                Funds {direction === 'remove' ? 'Removed' : 'Added'} Successfully!
              </p>
              <p className="text-muted-foreground">
                {formatCurrency(parsedAmount)} has been {direction === 'remove' ? 'removed' : 'credited'}.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Current Balance */}
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Current Scout Funds Balance</p>
              <p className="text-2xl font-semibold text-green-600">
                {formatCurrency(currentFundsBalance)}
              </p>
            </div>

            {/* Direction Toggle */}
            <div className="space-y-2">
              <Label>Action</Label>
              <div className="flex rounded-lg border border-stone-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDirection('add')}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    direction === 'add'
                      ? 'bg-forest-600 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('remove')}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    direction === 'remove'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Remove
                </button>
              </div>
            </div>

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

            {/* Fundraiser Type - only show if types exist and adding */}
            {!isRemove && (
              loading ? (
                <div className="space-y-2">
                  <Label htmlFor="fundraiser-type">Fundraiser Type</Label>
                  <div className="h-10 rounded-md border bg-muted animate-pulse" />
                </div>
              ) : fundraiserTypes.length > 0 ? (
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
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes {isRemove ? '(required)' : '(optional)'}</Label>
              <Textarea
                id="notes"
                placeholder="e.g., Wreath order #123, 5 wreaths sold"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={isProcessing}
              />
            </div>

            {/* Balance exceeded error */}
            {exceedsBalance && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Amount exceeds current balance of {formatCurrency(currentFundsBalance)}</span>
              </div>
            )}

            {/* Summary */}
            {parsedAmount > 0 && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Amount to {isRemove ? 'Remove' : 'Credit'}
                  </span>
                  <span className="font-medium">{formatCurrency(parsedAmount)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>New Funds Balance</span>
                  <span className={isRemove ? 'text-red-600' : 'text-green-600'}>
                    {formatCurrency(
                      isRemove
                        ? currentFundsBalance - parsedAmount
                        : currentFundsBalance + parsedAmount
                    )}
                  </span>
                </div>
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
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isProcessing}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!isValid || isProcessing}
                className="flex-1"
              >
                {isProcessing
                  ? (isRemove ? 'Removing Funds...' : 'Adding Funds...')
                  : (isRemove ? 'Remove Funds' : 'Add Funds')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
