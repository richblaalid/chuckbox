'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'
import { BillingForm } from '@/components/billing/billing-form'
import { ReminderSelectionDialog } from './reminder-selection-dialog'
import { BulkReminderWrapper } from './bulk-reminder-wrapper'
import { Receipt, DollarSign, Bell, Upload } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string; billing_balance?: number | null; funds_balance?: number | null } | null
  patrols: { name: string } | null
}

interface FinanceActionBarProps {
  unitId: string
  unitName: string
  scouts: Scout[]
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
}

export function FinanceActionBar({ unitId, unitName, scouts, squareConfig }: FinanceActionBarProps) {
  const router = useRouter()
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [isSelectionOpen, setIsSelectionOpen] = useState(false)
  const [isReminderOpen, setIsReminderOpen] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  const handlePaymentSuccess = () => {
    setTimeout(() => {
      setIsPaymentOpen(false)
      router.refresh()
    }, 1500)
  }

  const handleBillingSuccess = () => {
    setIsBillingOpen(false)
    router.refresh()
  }

  const handleSelectionConfirm = (accountIds: string[]) => {
    setSelectedAccountIds(accountIds)
    setIsSelectionOpen(false)
    setIsReminderOpen(true)
  }

  const handleReminderSuccess = () => {
    setIsReminderOpen(false)
    setSelectedAccountIds([])
    router.refresh()
  }

  const accountsOwingMoney = scouts
    .filter((s) => s.scout_accounts && (s.scout_accounts.billing_balance ?? 0) < 0)
    .map((s) => s.scout_accounts!.id)

  const owingCount = accountsOwingMoney.length

  const scoutsForPayment = scouts.map((s) => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    scout_accounts: s.scout_accounts
      ? {
          id: s.scout_accounts.id,
          billing_balance: s.scout_accounts.billing_balance ?? null,
          funds_balance: s.scout_accounts.funds_balance ?? null,
        }
      : null,
  }))

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" className="gap-2" onClick={() => setIsBillingOpen(true)}>
          <Receipt className="h-4 w-4" />
          Create Billing
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => setIsPaymentOpen(true)}>
          <DollarSign className="h-4 w-4" />
          Record Payment
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => setIsSelectionOpen(true)}
          disabled={owingCount === 0}
        >
          <Bell className="h-4 w-4" />
          Send Reminders
          {owingCount > 0 && (
            <span className="ml-1 rounded-full bg-stone-200 px-1.5 py-0.5 text-xs font-medium text-stone-700">
              {owingCount}
            </span>
          )}
        </Button>
        <Button variant="outline" className="gap-2" asChild>
          <Link href="/settings/import/charges">
            <Upload className="h-4 w-4" />
            Import Charges
          </Link>
        </Button>
      </div>

      {/* Record Payment Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <QuickPaymentForm
            unitId={unitId}
            scouts={scoutsForPayment}
            squareConfig={squareConfig}
            onSuccess={handlePaymentSuccess}
            onCancel={() => setIsPaymentOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Create Billing Dialog */}
      <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create Billing</DialogTitle>
          </DialogHeader>
          <BillingForm unitId={unitId} scouts={scouts} onSuccess={handleBillingSuccess} />
        </DialogContent>
      </Dialog>

      {/* Reminder Selection Dialog */}
      <ReminderSelectionDialog
        open={isSelectionOpen}
        onOpenChange={setIsSelectionOpen}
        scouts={scouts}
        onConfirm={handleSelectionConfirm}
      />

      {/* Send Reminders Dialog */}
      <BulkReminderWrapper
        open={isReminderOpen}
        onOpenChange={setIsReminderOpen}
        selectedAccountIds={selectedAccountIds}
        unitId={unitId}
        unitName={unitName}
        onSuccess={handleReminderSuccess}
      />
    </>
  )
}
