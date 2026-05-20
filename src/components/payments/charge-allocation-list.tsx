'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import type { OutstandingCharge, RowState, AllocationResult } from '@/lib/payment-allocation'

interface Props {
  charges: OutstandingCharge[]
  rows: RowState[]
  result: AllocationResult
  onRowChange: (chargeId: string, change: Partial<RowState>) => void
}

function sortCharges(charges: OutstandingCharge[]): OutstandingCharge[] {
  return [...charges].sort((a, b) => {
    const d = a.billingDate.localeCompare(b.billingDate)
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
  })
}

export function ChargeAllocationList({ charges, rows, result, onRowChange }: Props) {
  const sorted = sortCharges(charges)

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No outstanding charges.</p>
  }

  const rowByCharge = new Map(rows.map((r) => [r.chargeId, r]))

  return (
    <div className="rounded-md border divide-y">
      {sorted.map((charge) => {
        const row = rowByCharge.get(charge.id)
        if (!row) return null

        const owed = Math.max(0, charge.amount - (charge.paidAmount || 0))
        const isAutoExtended = result.autoExtendedIds.has(charge.id)
        const isEffectivelyChecked = row.checked || isAutoExtended
        const isPartiallyPaid = (charge.paidAmount || 0) > 0
        const allocatedAmount = result.rowAmounts[charge.id] ?? 0

        // Input shows: manual value (if any), engine-computed amount otherwise.
        const inputValue = row.manualAmount !== null
          ? String(row.manualAmount)
          : (allocatedAmount > 0 ? allocatedAmount.toFixed(2) : '')

        return (
          <div key={charge.id} className="flex items-start gap-3 px-4 py-3">
            <Checkbox
              id={`charge-${charge.id}`}
              checked={row.checked}
              onCheckedChange={(checked) =>
                onRowChange(charge.id, { checked: Boolean(checked), manualAmount: null })
              }
              className="mt-0.5"
            />
            <label
              htmlFor={`charge-${charge.id}`}
              className="flex-1 cursor-pointer space-y-0.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{charge.description}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(owed)}
                </span>
              </div>
              {isPartiallyPaid && (
                <p className="text-xs text-muted-foreground">
                  Partially paid — {formatCurrency(charge.paidAmount)} of {formatCurrency(charge.amount)} paid
                </p>
              )}
              {isAutoExtended && !row.checked && (
                <p className="text-xs text-amber-700">auto-added</p>
              )}
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-500 text-sm">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={inputValue}
                disabled={!isEffectivelyChecked}
                onChange={(e) => {
                  const v = e.target.value
                  onRowChange(charge.id, {
                    manualAmount: v === '' ? null : parseFloat(v),
                  })
                }}
                className="w-24 pl-6 text-right"
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
