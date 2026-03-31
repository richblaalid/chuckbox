'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'
import { BillingForm } from '@/components/billing/billing-form'
import { FinanceActionBar } from './finance-action-bar'
import { ScoutsOwingTable, type ScoutOwing } from './scouts-owing-table'
import { ReminderSelectionDialog } from './reminder-selection-dialog'
import { BulkReminderWrapper } from './bulk-reminder-wrapper'

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string; billing_balance?: number | null; funds_balance?: number | null } | null
  patrols: { name: string } | null
}

interface OverviewActionsProps {
  unitId: string
  unitName: string
  scouts: Scout[]
  scoutsOwing: ScoutOwing[]
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
}

export function OverviewActions({ unitId, unitName, scouts, scoutsOwing, squareConfig }: OverviewActionsProps) {
  const router = useRouter()
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [preselectedScoutId, setPreselectedScoutId] = useState<string | undefined>()
  const [isReminderOpen, setIsReminderOpen] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

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

  const handleRecordPayment = (scoutAccountId: string) => {
    // Find the scout by account ID to get scout ID for preselection
    const scout = scouts.find((s) => s.scout_accounts?.id === scoutAccountId)
    setPreselectedScoutId(scout?.id)
    setIsPaymentOpen(true)
  }

  const handleSendReminder = (scoutAccountId: string) => {
    setSelectedAccountIds([scoutAccountId])
    setIsReminderOpen(true)
  }

  const handlePaymentSuccess = () => {
    setTimeout(() => {
      setIsPaymentOpen(false)
      setPreselectedScoutId(undefined)
      router.refresh()
    }, 1500)
  }

  const handleReminderSuccess = () => {
    setIsReminderOpen(false)
    setSelectedAccountIds([])
    router.refresh()
  }

  return (
    <>
      <FinanceActionBar
        unitId={unitId}
        unitName={unitName}
        scouts={scouts}
        squareConfig={squareConfig}
      />

      <ScoutsOwingTable
        scouts={scoutsOwing}
        onRecordPayment={handleRecordPayment}
        onSendReminder={handleSendReminder}
      />

      {/* Row-level Record Payment Dialog (with preselected scout) */}
      <Dialog open={isPaymentOpen} onOpenChange={(open) => {
        setIsPaymentOpen(open)
        if (!open) setPreselectedScoutId(undefined)
      }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <QuickPaymentForm
            unitId={unitId}
            scouts={scoutsForPayment}
            squareConfig={squareConfig}
            preselectedScoutId={preselectedScoutId}
            onSuccess={handlePaymentSuccess}
            onCancel={() => {
              setIsPaymentOpen(false)
              setPreselectedScoutId(undefined)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Row-level Send Reminder Dialog */}
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
