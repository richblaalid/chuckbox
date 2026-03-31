'use client'

import { useState } from 'react'
import { MoreHorizontal, Pencil, Ban, Bell, Mail } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { VoidBillingDialog } from './void-billing-dialog'
import { EditBillingDialog } from './edit-billing-dialog'
import { SendChargeNotificationDialog } from './send-charge-notification-dialog'

interface BillingRecordActionsProps {
  billingRecordId: string
  description: string
  totalAmount: number
  isVoid: boolean
  hasPaidCharges: boolean
  hasUnpaidCharges?: boolean
  canEdit: boolean
  canVoid: boolean
}

export function BillingRecordActions({
  billingRecordId,
  description,
  totalAmount,
  isVoid,
  hasPaidCharges,
  hasUnpaidCharges = false,
  canEdit,
  canVoid,
}: BillingRecordActionsProps) {
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [isNotifying, setIsNotifying] = useState(false)

  const handleSendReminder = async () => {
    setIsNotifying(true)
    try {
      await fetch(`/api/billing-records/${billingRecordId}/notify`, { method: 'POST' })
    } finally {
      setIsNotifying(false)
    }
  }

  if (isVoid) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasUnpaidCharges && (
            <DropdownMenuItem onClick={handleSendReminder} disabled={isNotifying}>
              <Bell className="mr-2 h-4 w-4" />
              Send Billing Reminder
            </DropdownMenuItem>
          )}
          {canEdit && (
            <>
              {hasUnpaidCharges && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Description
              </DropdownMenuItem>
            </>
          )}
          {canVoid && (
            <>
              {canEdit && <DropdownMenuSeparator />}
              {hasPaidCharges ? (
                <DropdownMenuItem disabled className="text-stone-400">
                  <Ban className="mr-2 h-4 w-4" />
                  Cannot void (has payments)
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setShowVoidDialog(true)}
                  className="text-error focus:text-error focus:bg-error-light"
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Void Record
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditBillingDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        billingRecordId={billingRecordId}
        currentDescription={description}
      />

      <VoidBillingDialog
        open={showVoidDialog}
        onOpenChange={setShowVoidDialog}
        billingRecordId={billingRecordId}
        description={description}
        amount={totalAmount}
        type="record"
      />
    </>
  )
}

interface BillingChargeActionsProps {
  billingChargeId: string
  billingDescription: string
  amount: number
  scoutName: string
  scoutId: string
  isVoid: boolean
  isPaid: boolean
  canVoid: boolean
}

export function BillingChargeActions({
  billingChargeId,
  billingDescription,
  amount,
  scoutName,
  scoutId,
  isVoid,
  isPaid,
  canVoid,
}: BillingChargeActionsProps) {
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [showNotifyDialog, setShowNotifyDialog] = useState(false)

  if (isVoid) {
    return null
  }

  // Show menu if user can void OR if charge is unpaid (for notification)
  const showMenu = canVoid || !isPaid

  if (!showMenu) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <MoreHorizontal className="h-3 w-3" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isPaid && (
            <DropdownMenuItem onClick={() => setShowNotifyDialog(true)}>
              <Mail className="mr-2 h-4 w-4" />
              Send Notification
            </DropdownMenuItem>
          )}
          {canVoid && !isPaid && <DropdownMenuSeparator />}
          {canVoid && (
            isPaid ? (
              <DropdownMenuItem disabled className="text-stone-400">
                <Ban className="mr-2 h-4 w-4" />
                Cannot void (paid)
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setShowVoidDialog(true)}
                className="text-error focus:text-error focus:bg-error-light"
              >
                <Ban className="mr-2 h-4 w-4" />
                Void Charge
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <VoidBillingDialog
        open={showVoidDialog}
        onOpenChange={setShowVoidDialog}
        billingChargeId={billingChargeId}
        description={billingDescription}
        amount={amount}
        scoutName={scoutName}
        type="charge"
      />

      <SendChargeNotificationDialog
        open={showNotifyDialog}
        onOpenChange={setShowNotifyDialog}
        billingChargeId={billingChargeId}
        scoutId={scoutId}
        amount={amount}
        description={billingDescription}
        scoutName={scoutName}
      />
    </>
  )
}
