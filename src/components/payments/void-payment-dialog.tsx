'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatDate } from '@/lib/utils'
import { voidPayment } from '@/app/actions/funds'
import { AlertCircle, Ban } from 'lucide-react'

interface Payment {
  id: string
  amount: number
  payment_method: string | null
  created_at: string | null
  notes: string | null
  scout_name?: string
}

interface VoidPaymentDialogProps {
  payment: Payment
  open: boolean
  onOpenChange: (open: boolean) => void
  onVoided?: () => void
}

export function VoidPaymentDialog({
  payment,
  open,
  onOpenChange,
  onVoided,
}: VoidPaymentDialogProps) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleVoid = async () => {
    if (!reason.trim()) {
      setError('Please provide a reason for voiding this payment')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const result = await voidPayment(payment.id, reason.trim())

      if (!result.success) {
        setError(result.error || 'Failed to void payment')
        setIsProcessing(false)
        return
      }

      // Refresh the page data, notify parent, and close dialog
      router.refresh()
      onVoided?.()
      onOpenChange(false)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsProcessing(false)
    }
  }

  const handleCancel = () => {
    setReason('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Payment
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Voiding this payment will create a
            reversal journal entry and restore the scout&apos;s balance.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {/* Payment Details */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="font-medium">{formatCurrency(payment.amount)}</span>
            </div>
            {payment.scout_name && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Scout</span>
                <span>{payment.scout_name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Method</span>
              <span className="capitalize">{payment.payment_method || 'Unknown'}</span>
            </div>
            {payment.created_at && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Date</span>
                <span>{formatDate(payment.created_at)}</span>
              </div>
            )}
            {payment.notes && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Notes</span>
                <span className="text-right max-w-[200px]">{payment.notes}</span>
              </div>
            )}
          </div>

          {/* Reason Input */}
          <div className="space-y-2">
            <Label htmlFor="void-reason">
              Reason for voiding <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="void-reason"
              placeholder="e.g., Incorrect amount entered, payment applied to wrong scout"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={isProcessing}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isProcessing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleVoid()
            }}
            disabled={!reason.trim() || isProcessing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isProcessing ? 'Voiding...' : 'Void Payment'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
