'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { BillingRecordActions, BillingChargeActions } from './billing-record-actions'

interface BillingCharge {
  id: string
  amount: number
  is_paid: boolean | null
  is_void: boolean | null
  scout_accounts: {
    scout_id: string
    scouts: {
      first_name: string
      last_name: string
    } | null
  } | null
}

interface BillingRecordCardProps {
  id: string
  description: string
  totalAmount: number
  billingDate: string
  createdAt: string | null
  isVoid: boolean
  voidReason: string | null
  charges: BillingCharge[]
  canEdit: boolean
  canVoid: boolean
}

export function BillingRecordCard({
  id,
  description,
  totalAmount,
  billingDate,
  createdAt,
  isVoid,
  voidReason,
  charges,
  canEdit,
  canVoid,
}: BillingRecordCardProps) {
  const [expanded, setExpanded] = useState(false)

  const activeCharges = charges.filter(c => !c.is_void)
  const paidCount = activeCharges.filter(c => c.is_paid).length
  const unpaidCount = activeCharges.length - paidCount
  const hasPaidCharges = paidCount > 0

  // Calculate collectible total from active charges only
  const collectibleTotal = activeCharges.reduce((sum, c) => sum + c.amount, 0)
  const perScoutAmount = activeCharges.length > 0 ? collectibleTotal / activeCharges.length : 0

  return (
    <div className={`rounded-lg border shadow-sm transition-all duration-200 ${isVoid ? 'border-stone-200 bg-stone-50' : 'border-stone-200 bg-white hover:border-amber-200 hover:shadow-md hover:-translate-y-0.5'}`}>
      {/* Clickable Header - using div with role="button" to allow nested interactive elements */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        className={`w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer ${isVoid ? 'opacity-60' : ''}`}
      >
        {/* Expand Icon */}
        <div className="text-stone-400">
          {expanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </div>

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold truncate ${isVoid ? 'text-stone-500 line-through' : 'text-stone-900'}`}>
              {description}
            </span>
            {isVoid && (
              <span className="inline-flex items-center rounded bg-stone-200 px-1.5 py-0.5 text-xs font-medium text-stone-600 flex-shrink-0">
                Voided
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-stone-500">
            <span className="whitespace-nowrap">{formatDate(createdAt || billingDate)}</span>
            <span className="text-stone-300 hidden sm:inline">·</span>
            <span className="whitespace-nowrap">{activeCharges.length} scouts @ {formatCurrency(perScoutAmount)}</span>
          </div>
        </div>

        {/* Status Summary - hidden on mobile, shown on sm+ */}
        {!isVoid && (
          <div className="hidden sm:flex items-center gap-2 text-sm flex-shrink-0">
            {paidCount > 0 && (
              <span className="inline-flex items-center rounded bg-forest-100 px-2 py-1 text-xs font-medium text-forest-700">
                {paidCount} paid
              </span>
            )}
            {unpaidCount > 0 && (
              <span className="inline-flex items-center rounded bg-stone-100 px-2 py-1 text-xs font-medium text-stone-600">
                {unpaidCount} unpaid
              </span>
            )}
          </div>
        )}

        {/* Total */}
        <div className="text-right ml-2 flex-shrink-0">
          <span className={`text-lg font-bold ${isVoid ? 'text-stone-400' : 'text-stone-900'}`}>
            {formatCurrency(collectibleTotal)}
          </span>
        </div>

        {/* Actions - stop propagation to prevent expand/collapse */}
        {!isVoid && (canEdit || canVoid) && (
          <div onClick={(e) => e.stopPropagation()}>
            <BillingRecordActions
              billingRecordId={id}
              description={description}
              totalAmount={totalAmount}
              isVoid={isVoid}
              hasCollectedPayments={hasPaidCharges}
              canEdit={canEdit}
              canVoid={canVoid}
            />
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className={`border-t border-stone-200 bg-stone-100 border-l-4 border-l-forest-500 ${isVoid ? 'opacity-60' : ''}`}>
          {isVoid && voidReason && (
            <div className="px-4 py-2 bg-stone-100 text-xs text-stone-500">
              Void reason: {voidReason}
            </div>
          )}
          <div className="divide-y divide-stone-200">
            {charges.map((charge) => {
              const chargeIsVoid = charge.is_void === true
              const scoutName = `${charge.scout_accounts?.scouts?.first_name || ''} ${charge.scout_accounts?.scouts?.last_name || ''}`

              return (
                <div key={charge.id} className={`flex items-center gap-2 sm:gap-3 px-4 py-3 ${chargeIsVoid ? 'bg-stone-100' : ''}`}>
                  {/* Spacer to align with expand icon - hidden on mobile */}
                  <div className="w-5 flex-shrink-0 hidden sm:block" />

                  {/* Scout name - aligned with card title */}
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium truncate block ${chargeIsVoid ? 'line-through text-stone-400' : 'text-stone-900'}`}>
                      {scoutName}
                    </span>
                  </div>

                  {/* Amount and Status - right aligned with total */}
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {chargeIsVoid ? (
                      <span className="inline-flex items-center rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-500">
                        Voided
                      </span>
                    ) : charge.is_paid ? (
                      <span className="inline-flex items-center rounded bg-forest-100 px-2 py-0.5 text-xs font-medium text-forest-700">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded bg-white border border-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600">
                        Unpaid
                      </span>
                    )}
                    <span className={`text-right min-w-[60px] sm:min-w-[70px] ${chargeIsVoid ? 'text-stone-400' : 'text-stone-700'}`}>
                      {formatCurrency(charge.amount)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="w-8 flex-shrink-0 flex justify-end">
                    {!chargeIsVoid && (
                      <BillingChargeActions
                        billingChargeId={charge.id}
                        billingDescription={description}
                        amount={charge.amount}
                        scoutName={scoutName}
                        scoutId={charge.scout_accounts?.scout_id || ''}
                        isVoid={chargeIsVoid}
                        isPaid={!!charge.is_paid}
                        canVoid={canVoid}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
