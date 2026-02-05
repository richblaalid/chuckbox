'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'

interface VoidBillingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  billingRecordId?: string
  billingChargeId?: string
  description: string
  amount: number
  scoutName?: string
  type: 'record' | 'charge'
}

export function VoidBillingDialog({
  open,
  onOpenChange,
  billingRecordId,
  billingChargeId,
  description,
  amount,
  scoutName,
  type,
}: VoidBillingDialogProps) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleVoid = async () => {
    if (!reason.trim()) {
      setError('Please provide a reason for voiding')
      return
    }

    setIsLoading(true)
    setError(null)

    const supabase = createClient()

    try {
      const { error: rpcError } = type === 'record'
        ? await supabase.rpc('void_billing_record', {
            p_billing_record_id: billingRecordId!,
            p_void_reason: reason,
          })
        : await supabase.rpc('void_billing_charge', {
            p_billing_charge_id: billingChargeId!,
            p_void_reason: reason,
          })

      if (rpcError) throw rpcError

      setReason('')
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!isLoading) {
      if (!newOpen) {
        setReason('')
        setError(null)
      }
      onOpenChange(newOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Void {type === 'record' ? 'Billing Record' : 'Charge'}?
          </DialogTitle>
          <DialogDescription>
            {type === 'record' ? (
              <>
                This will void all charges in &ldquo;{description}&rdquo; and create
                reversal journal entries to adjust scout account balances.
              </>
            ) : (
              <>
                This will void the {formatCurrency(amount)} charge for {scoutName} and
                create a reversal journal entry to adjust their account balance.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm">
            <p className="font-medium text-stone-900">{description}</p>
            <p className="text-stone-600">
              {type === 'record' ? 'Total: ' : `${scoutName}: `}
              {formatCurrency(amount)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-reason">Reason for voiding *</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Entered wrong amount, Scout dropped out"
              disabled={isLoading}
            />
            <p className="text-xs text-stone-500">
              This reason will be recorded for audit purposes.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-error-light p-3 text-sm text-error">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={isLoading || !reason.trim()}
          >
            {isLoading ? 'Voiding...' : 'Void'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
