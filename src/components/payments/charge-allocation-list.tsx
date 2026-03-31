'use client'

import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency } from '@/lib/utils'
import { allocatePayment, type OutstandingCharge, type Allocation } from '@/lib/payment-allocation'

interface ChargeAllocationListProps {
  charges: OutstandingCharge[]
  paymentAmount: number
  onAllocationsChange: (allocations: Allocation[]) => void
  onAmountChange?: (amount: number) => void
}

function sortCharges(charges: OutstandingCharge[]): OutstandingCharge[] {
  return [...charges].sort((a, b) => {
    const dateComp = a.billingDate.localeCompare(b.billingDate)
    if (dateComp !== 0) return dateComp
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export function ChargeAllocationList({
  charges,
  paymentAmount,
  onAllocationsChange,
  onAmountChange,
}: ChargeAllocationListProps) {
  const sorted = sortCharges(charges)

  const [manualOverride, setManualOverride] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const auto = allocatePayment(sorted, paymentAmount)
    return new Set(auto.map((a) => a.chargeId))
  })

  // Reset manual override when charges list identity changes
  useEffect(() => {
    setManualOverride(false)
    const auto = allocatePayment(sortCharges(charges), paymentAmount)
    setCheckedIds(new Set(auto.map((a) => a.chargeId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charges])

  // Auto-allocate when paymentAmount changes (unless user has overridden)
  useEffect(() => {
    if (manualOverride) return
    const auto = allocatePayment(sortCharges(charges), paymentAmount)
    setCheckedIds(new Set(auto.map((a) => a.chargeId)))
  }, [paymentAmount, manualOverride, charges])

  // Notify parent when checked set changes
  useEffect(() => {
    const allocations: Allocation[] = sorted
      .filter((c) => checkedIds.has(c.id))
      .map((c) => {
        const owed = c.amount - c.paidAmount
        return { chargeId: c.id, amount: owed }
      })
    onAllocationsChange(allocations)
  }, [checkedIds, sorted, onAllocationsChange])

  function handleToggle(charge: OutstandingCharge, checked: boolean) {
    const next = new Set(checkedIds)
    if (checked) {
      next.add(charge.id)
    } else {
      next.delete(charge.id)
    }
    setCheckedIds(next)
    setManualOverride(true)

    if (onAmountChange) {
      const total = sorted
        .filter((c) => next.has(c.id))
        .reduce((sum, c) => sum + (c.amount - c.paidAmount), 0)
      onAmountChange(total)
    }
  }

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No outstanding charges.</p>
    )
  }

  return (
    <div className="rounded-md border divide-y">
      {sorted.map((charge) => {
        const owed = charge.amount - charge.paidAmount
        const isChecked = checkedIds.has(charge.id)
        const isPartiallyPaid = charge.paidAmount > 0

        return (
          <div key={charge.id} className="flex items-start gap-3 px-4 py-3">
            <Checkbox
              id={`charge-${charge.id}`}
              checked={isChecked}
              onCheckedChange={(checked) => handleToggle(charge, Boolean(checked))}
              className="mt-0.5"
            />
            <label
              htmlFor={`charge-${charge.id}`}
              className="flex-1 cursor-pointer space-y-0.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{charge.description}</span>
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(owed)}
                </span>
              </div>
              {isPartiallyPaid && (
                <p className="text-xs text-muted-foreground">
                  Partially paid — {formatCurrency(charge.paidAmount)} of{' '}
                  {formatCurrency(charge.amount)} paid
                </p>
              )}
            </label>
          </div>
        )
      })}
    </div>
  )
}
