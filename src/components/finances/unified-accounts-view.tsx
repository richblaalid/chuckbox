'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UnifiedScoutAccountsTable, ScoutAccountRow } from './unified-scout-accounts-table'
import { BulkActionBar } from './bulk-action-bar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { BillingForm } from '@/components/billing/billing-form'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'
import { BulkReminderWrapper } from './bulk-reminder-wrapper'
import { Plus, Upload } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string } | null
  patrols: { name: string } | null
}

interface ScoutForPayment {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance: number | null
  } | null
}

interface UnifiedAccountsViewProps {
  unitId: string
  unitName?: string
  scouts: ScoutAccountRow[]
  patrols: string[]
  scoutsForBilling: Scout[]
  scoutsForPayment?: ScoutForPayment[]
  canTakeActions: boolean
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
}

export function UnifiedAccountsView({
  unitId,
  unitName = 'your unit',
  scouts,
  patrols,
  scoutsForBilling,
  scoutsForPayment = [],
  canTakeActions,
  squareConfig,
}: UnifiedAccountsViewProps) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [isReminderOpen, setIsReminderOpen] = useState(false)

  // Individual action dialog states
  const [actionScout, setActionScout] = useState<ScoutAccountRow | null>(null)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isIndividualBillingOpen, setIsIndividualBillingOpen] = useState(false)
  const [isIndividualReminderOpen, setIsIndividualReminderOpen] = useState(false)

  // Navigate to account detail on row click
  const handleScoutSelect = (scout: ScoutAccountRow) => {
    router.push(`/finances/accounts/${scout.id}`)
  }

  const handleBillSelected = () => {
    setIsBillingOpen(true)
  }

  const handleSuccess = () => {
    router.refresh()
    setIsBillingOpen(false)
    setSelectedIds([])
  }

  // Individual action handlers
  const handleRecordPayment = (scout: ScoutAccountRow) => {
    setActionScout(scout)
    setIsPaymentOpen(true)
  }

  const handleCreateBilling = (scout: ScoutAccountRow) => {
    setActionScout(scout)
    setIsIndividualBillingOpen(true)
  }

  const handleSendReminder = (scout: ScoutAccountRow) => {
    setActionScout(scout)
    setIsIndividualReminderOpen(true)
  }

  const handleActionSuccess = () => {
    router.refresh()
    setIsPaymentOpen(false)
    setIsIndividualBillingOpen(false)
    setIsIndividualReminderOpen(false)
    setActionScout(null)
  }

  // Find the scout for payment form
  const selectedPaymentScout = actionScout
    ? scoutsForPayment.find((s) => s.id === actionScout.scoutId)
    : null

  // Find the scout for billing form
  const selectedBillingScout = actionScout
    ? scoutsForBilling.find((s) => s.id === actionScout.scoutId)
    : null

  return (
    <div className="space-y-4">
      {/* Header with Create Billing button */}
      {canTakeActions && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Billing
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Billing</DialogTitle>
                </DialogHeader>
                <BillingForm
                  unitId={unitId}
                  scouts={scoutsForBilling}
                />
              </DialogContent>
            </Dialog>
          </div>
          <Link href="/settings/import/balances">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Import Balances
            </Button>
          </Link>
        </div>
      )}

      {/* Bulk Action Bar */}
      {canTakeActions && (
        <BulkActionBar
          selectedCount={selectedIds.length}
          onBillSelected={handleBillSelected}
          onAddFunds={() => {/* TODO: implement bulk add funds */}}
          onSendReminders={() => setIsReminderOpen(true)}
          onExport={() => {/* TODO: implement export */}}
          onClearSelection={() => setSelectedIds([])}
        />
      )}

      {/* Table */}
      <UnifiedScoutAccountsTable
        scouts={scouts}
        patrols={patrols}
        selectedIds={canTakeActions ? selectedIds : []}
        onScoutSelect={handleScoutSelect}
        onSelectionChange={canTakeActions ? setSelectedIds : () => {}}
        onRecordPayment={canTakeActions ? handleRecordPayment : undefined}
        onCreateBilling={canTakeActions ? handleCreateBilling : undefined}
        onSendReminder={canTakeActions ? handleSendReminder : undefined}
      />

      {/* Individual Payment Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Record Payment{actionScout ? ` for ${actionScout.scoutName}` : ''}
            </DialogTitle>
          </DialogHeader>
          {selectedPaymentScout && (
            <QuickPaymentForm
              unitId={unitId}
              scouts={[selectedPaymentScout]}
              squareConfig={squareConfig}
              preselectedScoutId={selectedPaymentScout.id}
              onSuccess={handleActionSuccess}
              onCancel={() => setIsPaymentOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Individual Billing Dialog */}
      <Dialog open={isIndividualBillingOpen} onOpenChange={setIsIndividualBillingOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Create Billing{actionScout ? ` for ${actionScout.scoutName}` : ''}
            </DialogTitle>
          </DialogHeader>
          {selectedBillingScout && (
            <BillingForm
              unitId={unitId}
              scouts={[selectedBillingScout]}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Individual Reminder Dialog */}
      {actionScout && (
        <BulkReminderWrapper
          open={isIndividualReminderOpen}
          onOpenChange={setIsIndividualReminderOpen}
          selectedAccountIds={[actionScout.id]}
          unitId={unitId}
          unitName={unitName}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* Bulk Reminder Dialog */}
      <BulkReminderWrapper
        open={isReminderOpen}
        onOpenChange={setIsReminderOpen}
        selectedAccountIds={selectedIds}
        unitId={unitId}
        unitName={unitName}
        onSuccess={() => {
          setIsReminderOpen(false)
          setSelectedIds([])
          router.refresh()
        }}
      />
    </div>
  )
}
