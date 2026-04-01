'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatDate } from '@/lib/utils'
import { canPerformAction } from '@/lib/roles'
import { updatePaymentNotes } from '@/app/actions/payments'
import { VoidPaymentDialog } from '@/components/payments/void-payment-dialog'
import { ReconcilePaymentDialog } from '@/components/payments/reconcile-payment-dialog'
import type { UnifiedRow, PaymentRow, UnreconciledRow } from '@/components/payments/unified-payments-list'
import {
  Banknote,
  FileText,
  CreditCard,
  ExternalLink,
  Pencil,
  Loader2,
} from 'lucide-react'

interface PaymentDetailSheetProps {
  row: UnifiedRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    scout_accounts: { id: string; billing_balance: number | null; funds_balance: number | null } | null
  }>
  unitId: string
  userRole: string
}

function isPaymentRow(row: UnifiedRow): row is PaymentRow {
  return row.type === 'payment'
}

function isUnreconciledRow(row: UnifiedRow): row is UnreconciledRow {
  return row.type === 'unreconciled_square'
}

function getMethodIcon(method: string | null) {
  switch (method?.toLowerCase()) {
    case 'cash':
      return <Banknote className="h-4 w-4" />
    case 'check':
      return <FileText className="h-4 w-4" />
    case 'card':
    case 'square':
      return <CreditCard className="h-4 w-4" />
    default:
      return null
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  )
}

function StatusBadge({ row }: { row: UnifiedRow }) {
  if (isPaymentRow(row) && row.voided_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-error-light px-2.5 py-0.5 text-xs font-medium text-error">
        Voided
      </span>
    )
  }
  if (isUnreconciledRow(row)) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        Unreconciled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-success-light px-2.5 py-0.5 text-xs font-medium text-success">
      Completed
    </span>
  )
}

export function PaymentDetailSheet({
  row,
  open,
  onOpenChange,
  scouts,
  unitId,
  userRole,
}: PaymentDetailSheetProps) {
  const router = useRouter()
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [reconcileDialogOpen, setReconcileDialogOpen] = useState(false)

  // Reset editing state when sheet closes or row changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setEditingNotes(false)
      setReconcileDialogOpen(false)
    }
    onOpenChange(newOpen)
  }

  if (!row) return null

  const title = isPaymentRow(row)
    ? row.scout_name || 'General Payment'
    : row.cardholder_name || 'Square Payment'

  const amount = isPaymentRow(row) ? row.amount : row.amount_money / 100
  const date = isPaymentRow(row) ? row.created_at : row.square_created_at
  const notes = isPaymentRow(row) ? row.notes : row.note
  const feeAmount = isPaymentRow(row) ? row.fee_amount : (row.fee_money ?? 0) / 100
  const netAmount = isPaymentRow(row) ? row.net_amount : row.net_money / 100
  const receiptUrl = isPaymentRow(row) ? row.square_receipt_url : row.receipt_url
  const isVoided = isPaymentRow(row) && !!row.voided_at
  const method = isPaymentRow(row) ? row.payment_method : (row.card_brand ? `${row.card_brand} ****${row.last_4}` : 'Card')

  const canEditNotes = isPaymentRow(row) && !isVoided && canPerformAction(userRole, 'edit_payment_notes')
  const canVoid = isPaymentRow(row) && !isVoided && canPerformAction(userRole, 'void_payments')

  const handleStartEditNotes = () => {
    setNotesValue(notes || '')
    setEditingNotes(true)
  }

  const handleSaveNotes = async () => {
    if (!isPaymentRow(row)) return
    setSavingNotes(true)
    try {
      const result = await updatePaymentNotes(row.id, notesValue.trim())
      if (result.success) {
        setEditingNotes(false)
        router.refresh()
      }
    } finally {
      setSavingNotes(false)
    }
  }

  const handleCancelEditNotes = () => {
    setEditingNotes(false)
    setNotesValue('')
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-[420px] sm:w-[420px] overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{title}</SheetTitle>
            <p className="text-3xl font-bold tracking-tight">
              {formatCurrency(amount)}
            </p>
          </SheetHeader>

          {/* Details Section */}
          <div className="rounded-lg border bg-muted/30 px-4">
            {date && (
              <DetailRow label="Date">{formatDate(date)}</DetailRow>
            )}

            <DetailRow label="Method">
              <span className="inline-flex items-center gap-1.5">
                {getMethodIcon(isPaymentRow(row) ? row.payment_method : 'card')}
                <span className="capitalize">{method || 'Unknown'}</span>
              </span>
            </DetailRow>

            <DetailRow label="Status">
              <StatusBadge row={row} />
            </DetailRow>

            {feeAmount != null && feeAmount !== 0 && (
              <DetailRow label="Fee">{formatCurrency(feeAmount)}</DetailRow>
            )}

            {netAmount !== amount && (
              <DetailRow label="Net Amount">{formatCurrency(netAmount)}</DetailRow>
            )}

            {isPaymentRow(row) && row.recorded_by_name && (
              <DetailRow label="Recorded By">{row.recorded_by_name}</DetailRow>
            )}

            {isPaymentRow(row) && row.journal_entry_id && (
              <DetailRow label="Journal Entry">
                <span className="font-mono text-xs">{row.journal_entry_id.slice(0, 8)}</span>
              </DetailRow>
            )}

            {isUnreconciledRow(row) && row.receipt_number && (
              <DetailRow label="Receipt #">{row.receipt_number}</DetailRow>
            )}

            {isUnreconciledRow(row) && row.buyer_email_address && (
              <DetailRow label="Buyer Email">{row.buyer_email_address}</DetailRow>
            )}

            {receiptUrl && (
              <DetailRow label="Square Receipt">
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </a>
              </DetailRow>
            )}
          </div>

          {/* Notes Section */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Notes</span>
              {canEditNotes && !editingNotes && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handleStartEditNotes}
                >
                  <Pencil className="h-3 w-3" />
                  Edit Notes
                </Button>
              )}
            </div>

            {editingNotes ? (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  rows={3}
                  placeholder="Add payment notes..."
                  disabled={savingNotes}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                  >
                    {savingNotes && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCancelEditNotes}
                    disabled={savingNotes}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {notes || 'No notes'}
              </p>
            )}
          </div>

          {/* Void Details */}
          {isPaymentRow(row) && isVoided && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <p className="mb-2 text-sm font-medium text-red-700 dark:text-red-400">
                Payment Voided
              </p>
              {row.void_reason && (
                <div className="flex justify-between py-1">
                  <span className="text-sm text-red-600/70 dark:text-red-400/70">Reason</span>
                  <span className="text-sm text-red-700 dark:text-red-400">{row.void_reason}</span>
                </div>
              )}
              {row.voided_by_name && (
                <div className="flex justify-between py-1">
                  <span className="text-sm text-red-600/70 dark:text-red-400/70">Voided By</span>
                  <span className="text-sm text-red-700 dark:text-red-400">{row.voided_by_name}</span>
                </div>
              )}
              {row.voided_at && (
                <div className="flex justify-between py-1">
                  <span className="text-sm text-red-600/70 dark:text-red-400/70">Date</span>
                  <span className="text-sm text-red-700 dark:text-red-400">{formatDate(row.voided_at)}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col gap-2">
            {canVoid && (
              <Button
                variant="destructive"
                onClick={() => setVoidDialogOpen(true)}
              >
                Void Payment
              </Button>
            )}

            {isUnreconciledRow(row) && (
              <Button
                variant="default"
                onClick={() => setReconcileDialogOpen(true)}
              >
                Reconcile
              </Button>
            )}
          </div>

        </SheetContent>
      </Sheet>

      {/* Void Payment Dialog */}
      {isPaymentRow(row) && (
        <VoidPaymentDialog
          payment={{
            id: row.id,
            amount: row.amount,
            payment_method: row.payment_method,
            created_at: row.created_at,
            notes: row.notes,
            scout_name: row.scout_name ?? undefined,
          }}
          open={voidDialogOpen}
          onOpenChange={setVoidDialogOpen}
        />
      )}

      {/* Reconcile Dialog */}
      {isUnreconciledRow(row) && (
        <ReconcilePaymentDialog
          transaction={{
            id: row.id,
            square_payment_id: row.square_payment_id,
            amount_money: row.amount_money,
            fee_money: row.fee_money,
            net_money: row.net_money,
            receipt_url: row.receipt_url,
            cardholder_name: row.cardholder_name,
            note: row.note,
          }}
          open={reconcileDialogOpen}
          onOpenChange={setReconcileDialogOpen}
          scouts={scouts}
          unitId={unitId}
        />
      )}
    </>
  )
}
