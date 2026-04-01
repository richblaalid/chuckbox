'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import { reconcileSquareTransaction } from '@/app/actions/reconcile'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, FileText, Loader2, User } from 'lucide-react'

interface ReconcilePaymentDialogProps {
  transaction: {
    id: string
    square_payment_id: string
    amount_money: number
    fee_money: number | null
    net_money: number
    receipt_url: string | null
    cardholder_name: string | null
    note: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    scout_accounts: {
      id: string
      billing_balance: number | null
      funds_balance: number | null
    } | null
  }>
  unitId: string
}

interface OutstandingCharge {
  id: string
  amount: number
  paid_amount: number | null
  is_paid: boolean | null
  billing_records: { description: string; billing_date: string } | null
}

function TransactionSummary({
  transaction,
}: {
  transaction: ReconcilePaymentDialogProps['transaction']
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2">
      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Amount</span>
        <span className="font-medium">
          {formatCurrency(transaction.amount_money / 100)}
        </span>
      </div>
      {transaction.fee_money != null && transaction.fee_money > 0 && (
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Fee</span>
          <span className="text-sm text-muted-foreground">
            -{formatCurrency(transaction.fee_money / 100)}
          </span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Net</span>
        <span className="font-medium">
          {formatCurrency(transaction.net_money / 100)}
        </span>
      </div>
      {transaction.cardholder_name && (
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Cardholder</span>
          <span className="text-sm">{transaction.cardholder_name}</span>
        </div>
      )}
      {transaction.note && (
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Note</span>
          <span className="text-sm text-right max-w-[200px]">
            {transaction.note}
          </span>
        </div>
      )}
    </div>
  )
}

export function ReconcilePaymentDialog({
  transaction,
  open,
  onOpenChange,
  scouts,
  unitId,
}: ReconcilePaymentDialogProps) {
  const router = useRouter()

  // Scout tab state
  const [selectedScoutAccountId, setSelectedScoutAccountId] = useState('')
  const [charges, setCharges] = useState<OutstandingCharge[]>([])
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [allocations, setAllocations] = useState<
    Array<{ chargeId: string; amount: number }>
  >([])
  const [scoutNotes, setScoutNotes] = useState('')

  // Not-scout tab state
  const [notScoutNotes, setNotScoutNotes] = useState('')

  // Shared state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter scouts to only those with accounts, sorted by last name
  const scoutsWithAccounts = scouts
    .filter((s) => {
      const account = Array.isArray(s.scout_accounts)
        ? s.scout_accounts[0]
        : s.scout_accounts
      return account != null
    })
    .sort((a, b) => a.last_name.localeCompare(b.last_name))

  // Find the selected scout for display name
  const selectedScout = scoutsWithAccounts.find((s) => {
    const account = Array.isArray(s.scout_accounts)
      ? s.scout_accounts[0]
      : s.scout_accounts
    return account?.id === selectedScoutAccountId
  })

  // Fetch outstanding charges when scout is selected
  const fetchCharges = useCallback(async (scoutAccountId: string) => {
    setLoadingCharges(true)
    setCharges([])
    setAllocations([])

    const supabase = createClient()
    const { data } = await supabase
      .from('billing_charges')
      .select(
        'id, amount, paid_amount, is_paid, billing_records(description, billing_date)'
      )
      .eq('scout_account_id', scoutAccountId)
      .or('is_paid.eq.false,is_paid.is.null')
      .is('is_void', null)
      .order('created_at', { ascending: true })

    if (data) {
      setCharges(
        data.map((c) => ({
          ...c,
          billing_records: Array.isArray(c.billing_records)
            ? c.billing_records[0]
            : c.billing_records,
        }))
      )
    }
    setLoadingCharges(false)
  }, [])

  useEffect(() => {
    if (selectedScoutAccountId) {
      fetchCharges(selectedScoutAccountId)
    }
  }, [selectedScoutAccountId, fetchCharges])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedScoutAccountId('')
      setCharges([])
      setAllocations([])
      setScoutNotes('')
      setNotScoutNotes('')
      setError(null)
    }
  }, [open])

  function handleChargeToggle(chargeId: string, chargeAmount: number) {
    setAllocations((prev) => {
      const exists = prev.find((a) => a.chargeId === chargeId)
      if (exists) {
        return prev.filter((a) => a.chargeId !== chargeId)
      }
      return [...prev, { chargeId, amount: chargeAmount }]
    })
  }

  async function handleScoutSubmit() {
    if (!selectedScoutAccountId || !selectedScout) return

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await reconcileSquareTransaction({
        type: 'scout',
        squareTransactionId: transaction.id,
        unitId,
        scoutAccountId: selectedScoutAccountId,
        scoutName: `${selectedScout.first_name} ${selectedScout.last_name}`,
        amount: transaction.amount_money / 100,
        feeAmount: (transaction.fee_money || 0) / 100,
        netAmount: transaction.net_money / 100,
        squarePaymentId: transaction.square_payment_id,
        receiptUrl: transaction.receipt_url,
        allocations,
        notes: scoutNotes || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Failed to reconcile transaction')
        setIsSubmitting(false)
        return
      }

      router.refresh()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleNotScoutSubmit() {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await reconcileSquareTransaction({
        type: 'not_scout',
        squareTransactionId: transaction.id,
        unitId,
        amount: transaction.amount_money / 100,
        feeAmount: (transaction.fee_money || 0) / 100,
        netAmount: transaction.net_money / 100,
        squarePaymentId: transaction.square_payment_id,
        receiptUrl: transaction.receipt_url,
        notes: notScoutNotes || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Failed to reconcile transaction')
        setIsSubmitting(false)
        return
      }

      router.refresh()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const remainingAmount =
    transaction.amount_money / 100 -
    allocations.reduce((sum, a) => sum + a.amount, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Reconcile Transaction</DialogTitle>
          <DialogDescription>
            Match this Square transaction to a scout payment or mark it as
            non-scout revenue.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="scout" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scout" className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              Link to Scout
            </TabsTrigger>
            <TabsTrigger
              value="not_scout"
              className="flex items-center gap-1.5"
            >
              <FileText className="h-4 w-4" />
              Not Scout-Related
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Link to Scout */}
          <TabsContent value="scout" className="space-y-4 mt-4">
            <TransactionSummary transaction={transaction} />

            <div className="space-y-2">
              <Label htmlFor="scout-select">Scout</Label>
              <Select
                value={selectedScoutAccountId}
                onValueChange={setSelectedScoutAccountId}
              >
                <SelectTrigger id="scout-select">
                  <SelectValue placeholder="Select a scout..." />
                </SelectTrigger>
                <SelectContent>
                  {scoutsWithAccounts.map((s) => {
                    const account = Array.isArray(s.scout_accounts)
                      ? s.scout_accounts[0]
                      : s.scout_accounts
                    return (
                      <SelectItem key={s.id} value={account!.id}>
                        {s.last_name}, {s.first_name}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Outstanding charges */}
            {selectedScoutAccountId && (
              <div className="space-y-2">
                <Label>Outstanding Charges</Label>
                {loadingCharges ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading charges...
                  </div>
                ) : charges.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No outstanding charges for this scout.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {charges.map((charge) => {
                      const outstanding =
                        charge.amount - (charge.paid_amount || 0)
                      const isChecked = allocations.some(
                        (a) => a.chargeId === charge.id
                      )
                      const description =
                        charge.billing_records?.description || 'Charge'

                      return (
                        <label
                          key={charge.id}
                          className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() =>
                              handleChargeToggle(charge.id, outstanding)
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {description}
                            </p>
                          </div>
                          <span className="text-sm font-medium whitespace-nowrap">
                            {formatCurrency(outstanding)}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                {allocations.length > 0 && (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-muted-foreground">
                      Remaining unallocated
                    </span>
                    <span
                      className={
                        remainingAmount < 0 ? 'text-destructive font-medium' : ''
                      }
                    >
                      {formatCurrency(remainingAmount)}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="scout-notes">Notes (optional)</Label>
              <Textarea
                id="scout-notes"
                placeholder="Optional notes about this reconciliation..."
                value={scoutNotes}
                onChange={(e) => setScoutNotes(e.target.value)}
                rows={2}
                disabled={isSubmitting}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleScoutSubmit}
              disabled={!selectedScoutAccountId || isSubmitting}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Reconciling...
                </>
              ) : (
                'Reconcile as Scout Payment'
              )}
            </Button>
          </TabsContent>

          {/* Tab 2: Not Scout-Related */}
          <TabsContent value="not_scout" className="space-y-4 mt-4">
            <TransactionSummary transaction={transaction} />

            <div className="space-y-2">
              <Label htmlFor="not-scout-notes">Notes (optional)</Label>
              <Textarea
                id="not-scout-notes"
                placeholder='e.g., "Camp store sale", "Fundraiser revenue"'
                value={notScoutNotes}
                onChange={(e) => setNotScoutNotes(e.target.value)}
                rows={3}
                disabled={isSubmitting}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleNotScoutSubmit}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Reconciling...
                </>
              ) : (
                'Reconcile as Non-Scout Revenue'
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
