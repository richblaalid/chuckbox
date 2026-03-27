'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react'

interface ChargeDetail {
  id: string
  amount: number
  is_paid: boolean | null
  scout_account_id: string
  scout_first_name: string
  scout_last_name: string
}

export interface BillingRecordSummary {
  id: string
  description: string
  billing_date: string
  created_at: string | null
  total_amount: number
  is_void: boolean | null
  charges: ChargeDetail[]
}

interface OutstandingBillsCardProps {
  billingRecords: BillingRecordSummary[]
  totalScoutsOwing: number
}

export function OutstandingBillsCard({ billingRecords, totalScoutsOwing }: OutstandingBillsCardProps) {
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null)

  const activeRecords = billingRecords.filter((r) => !r.is_void)

  const toggleExpand = (id: string) => {
    setExpandedRecord(expandedRecord === id ? null : id)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Outstanding Bills
        </CardTitle>
        <CardDescription>
          {totalScoutsOwing > 0
            ? `${totalScoutsOwing} scout${totalScoutsOwing !== 1 ? 's' : ''} with outstanding charges`
            : 'All charges are paid'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activeRecords.length > 0 ? (
          <div className="space-y-2">
            {activeRecords.map((record) => {
              const unpaidCharges = record.charges.filter((c) => !c.is_paid)
              const paidCharges = record.charges.filter((c) => c.is_paid)
              const unpaidTotal = unpaidCharges.reduce((sum, c) => sum + c.amount, 0)
              const isExpanded = expandedRecord === record.id
              const isFullyPaid = unpaidCharges.length === 0

              return (
                <div key={record.id} className="rounded-lg border border-stone-200">
                  <button
                    onClick={() => toggleExpand(record.id)}
                    className="flex w-full items-center justify-between p-3 text-left hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">
                          {record.description}
                        </p>
                        <p className="text-xs text-stone-500">
                          {new Date(record.billing_date).toLocaleDateString()} · {paidCharges.length}/{record.charges.length} paid
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {isFullyPaid ? (
                        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                          Paid
                        </Badge>
                      ) : (
                        <span className="text-sm font-medium text-error">
                          {formatCurrency(unpaidTotal)}
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-stone-100 px-3 pb-3">
                      <div className="mt-2 space-y-1.5">
                        {record.charges.map((charge) => (
                          <div
                            key={charge.id}
                            className="flex items-center justify-between py-1 text-sm"
                          >
                            <Link
                              href={`/finances/accounts/${charge.scout_account_id}`}
                              className="text-forest-600 hover:text-forest-800 hover:underline"
                            >
                              {charge.scout_first_name} {charge.scout_last_name}
                            </Link>
                            <div className="flex items-center gap-2">
                              <span className={charge.is_paid ? 'text-stone-400 line-through' : 'text-stone-900'}>
                                {formatCurrency(charge.amount)}
                              </span>
                              {charge.is_paid ? (
                                <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs px-1.5 py-0">
                                  Paid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs px-1.5 py-0">
                                  Unpaid
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-success">No outstanding billing records</p>
        )}
      </CardContent>
    </Card>
  )
}
