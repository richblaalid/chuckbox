'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'
import { markExpensePaid } from '@/app/actions/expenses'
import type { ExpenseReimbursementWithSubmitter } from '@/lib/expenses/types'

interface ExpensePaymentDialogProps {
  expense: ExpenseReimbursementWithSubmitter
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PAYMENT_METHODS = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'other', label: 'Other' },
]

export function ExpensePaymentDialog({
  expense,
  open,
  onOpenChange,
}: ExpensePaymentDialogProps) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setError(null)

    if (!paymentMethod) {
      setError('Please select a payment method')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await markExpensePaid({
        expense_id: expense.id,
        payment_method: paymentMethod,
        payment_reference: paymentReference || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Failed to mark expense as paid')
        return
      }

      // Success - close dialog and refresh
      onOpenChange(false)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setPaymentMethod('')
      setPaymentReference('')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Mark Expense as Paid</DialogTitle>
          <DialogDescription>
            Record the payment details for this expense reimbursement.
          </DialogDescription>
        </DialogHeader>

        {/* Expense Summary */}
        <div className="rounded-lg bg-stone-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-stone-900">{expense.description}</p>
              <p className="mt-1 text-sm text-stone-500">
                {formatDate(expense.expense_date)}
                {expense.vendor && ` · ${expense.vendor}`}
              </p>
              {expense.submitter && (
                <p className="mt-1 text-sm text-stone-500">
                  Pay to: {expense.submitter.full_name || expense.submitter.email}
                </p>
              )}
            </div>
            <span className="text-xl font-bold text-stone-900">
              {formatCurrency(Number(expense.amount))}
            </span>
          </div>
        </div>

        {/* Payment Details */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-method">
              Payment Method <span className="text-red-500">*</span>
            </Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="payment-method">
                <SelectValue placeholder="Select payment method..." />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-reference">
              Reference Number (optional)
            </Label>
            <Input
              id="payment-reference"
              placeholder="Check #, transaction ID, etc."
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !paymentMethod}
          >
            {isSubmitting ? 'Recording...' : 'Mark as Paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
