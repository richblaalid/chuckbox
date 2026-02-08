'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { QuickPaymentForm } from './quick-payment-form'
import { DollarSign } from 'lucide-react'

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

interface QuickPaymentDialogProps {
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
}

export function QuickPaymentDialog({ unitId, scouts, squareConfig, preselectedScoutId }: QuickPaymentDialogProps) {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  const handleSuccess = useCallback(() => {
    // Close dialog after short delay to show success message
    setTimeout(() => {
      setOpen(false)
      // Reset form state for next time
      setFormKey((k) => k + 1)
    }, 1500)
  }, [])

  const handleCancel = useCallback(() => {
    setOpen(false)
    // Reset form state
    setFormKey((k) => k + 1)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-forest-700 text-white px-5 py-3 text-base font-semibold transition-colors hover:bg-forest-800 shadow-sm w-full sm:w-auto"
        >
          <DollarSign className="h-5 w-5" />
          Record Payment
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Record a cash, check, or card payment received from a scout family.
          </DialogDescription>
        </DialogHeader>
        <QuickPaymentForm
          key={formKey}
          unitId={unitId}
          scouts={scouts}
          squareConfig={squareConfig}
          preselectedScoutId={preselectedScoutId}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
