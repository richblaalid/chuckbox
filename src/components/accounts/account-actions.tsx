'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaymentModal } from './payment-modal'
import { SendPaymentRequestModal } from './send-payment-request-modal'
import { UseFundsModal } from './use-funds-modal'
import { AddFundsModal } from './add-funds-modal'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'
import { BillingForm } from '@/components/billing/billing-form'
import { Wallet, Receipt } from 'lucide-react'

interface AccountActionsProps {
  scoutId: string
  scoutAccountId: string
  scoutName: string
  billingBalance: number
  fundsBalance: number
  userRole: string
  isParent: boolean
  squareConfig: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  } | null
  unitId?: string
}

export function AccountActions({
  scoutId,
  scoutAccountId,
  scoutName,
  billingBalance,
  fundsBalance,
  userRole,
  isParent,
  squareConfig,
  unitId,
}: AccountActionsProps) {
  const router = useRouter()
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isUseFundsModalOpen, setIsUseFundsModalOpen] = useState(false)
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const isFinancialRole = userRole === 'admin' || userRole === 'treasurer'
  const owesBalance = billingBalance < 0
  const hasFunds = fundsBalance > 0
  const canUseFunds = hasFunds && owesBalance
  const canRecordPayment = isFinancialRole && unitId && owesBalance

  // Create scout data for QuickPaymentDialog and BillingForm
  const scoutData = [{
    id: scoutId,
    first_name: scoutName.split(' ')[0] || '',
    last_name: scoutName.split(' ').slice(1).join(' ') || '',
    is_active: true,
    scout_accounts: {
      id: scoutAccountId,
      billing_balance: billingBalance,
      funds_balance: fundsBalance,
    },
    patrols: null,
  }]

  const handleBillingSuccess = () => {
    setIsBillingOpen(false)
    router.refresh()
  }

  return (
    <div className="w-full space-y-4 sm:w-auto">
      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Financial role: Record Payment - only shows when scout owes money */}
        {canRecordPayment && (
          <QuickPaymentDialog
            unitId={unitId}
            scouts={scoutData}
            squareConfig={squareConfig || undefined}
            preselectedScoutId={scoutId}
          />
        )}

        {/* Financial role: Create Billing - always available */}
        {isFinancialRole && unitId && (
          <>
            <Button variant="default" className="gap-2" onClick={() => setIsBillingOpen(true)}>
              <Receipt className="h-4 w-4" />
              Create Billing
            </Button>
            <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Billing for {scoutName}</DialogTitle>
                </DialogHeader>
                <BillingForm
                  unitId={unitId}
                  scouts={scoutData}
                  preselectedScoutIds={[scoutId]}
                  onSuccess={handleBillingSuccess}
                />
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* Use Funds button - for parents when funds available and owes money */}
        {isParent && canUseFunds && (
          <>
            <Button
              onClick={() => setIsUseFundsModalOpen(true)}
              variant="outline"
              className="gap-2 border-success text-success hover:bg-success-light"
            >
              <Wallet className="h-4 w-4" />
              Use Scout Funds
            </Button>
            <UseFundsModal
              isOpen={isUseFundsModalOpen}
              onClose={() => setIsUseFundsModalOpen(false)}
              scoutAccountId={scoutAccountId}
              scoutName={scoutName}
              billingBalance={billingBalance}
              fundsBalance={fundsBalance}
            />
          </>
        )}

        {/* Parent actions */}
        {isParent && owesBalance && squareConfig && (
          <>
            <Button variant="default" onClick={() => setIsPaymentModalOpen(true)}>Make a Payment</Button>
            <PaymentModal
              isOpen={isPaymentModalOpen}
              onClose={() => setIsPaymentModalOpen(false)}
              scoutAccountId={scoutAccountId}
              scoutName={scoutName}
              currentBalance={billingBalance}
              applicationId={squareConfig.applicationId}
              locationId={squareConfig.locationId}
              environment={squareConfig.environment}
            />
          </>
        )}

        {/* Financial role: Send Payment Request */}
        {isFinancialRole && owesBalance && (
          <SendPaymentRequestModal
            scoutAccountId={scoutAccountId}
            scoutId={scoutId}
            scoutName={scoutName}
            balance={billingBalance}
          />
        )}

        {/* Financial role: Add Funds */}
        {isFinancialRole && unitId && (
          <AddFundsModal
            scoutAccountId={scoutAccountId}
            scoutName={scoutName}
            currentFundsBalance={fundsBalance}
            unitId={unitId}
          />
        )}
      </div>
    </div>
  )
}
