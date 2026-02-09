'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatCurrency, cn } from '@/lib/utils'
import { Printer, ChevronDown, ChevronRight, Users } from 'lucide-react'

interface Scout {
  scout_id: string
  scout_name: string
  billing_balance: number
  funds_balance: number
}

interface PatrolDues {
  patrol_name: string
  scout_count: number
  total_billed: number
  total_paid: number
  total_outstanding: number
  scouts: Scout[]
}

interface DuesByPatrolData {
  startDate: string
  endDate: string
  patrols: PatrolDues[]
  totals: {
    total_scouts: number
    total_billed: number
    total_paid: number
    total_outstanding: number
  }
}

interface DuesByPatrolReportProps {
  unitName: string
}

export function DuesByPatrolReport({ unitName }: DuesByPatrolReportProps) {
  const currentYear = new Date().getFullYear()
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`)
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<DuesByPatrolData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedPatrols, setExpandedPatrols] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/reports/dues-by-patrol?startDate=${startDate}&endDate=${endDate}`
        )
        if (!response.ok) {
          throw new Error('Failed to fetch dues by patrol data')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [startDate, endDate])

  const togglePatrol = (patrolName: string) => {
    setExpandedPatrols((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(patrolName)) {
        newSet.delete(patrolName)
      } else {
        newSet.add(patrolName)
      }
      return newSet
    })
  }

  const expandAll = () => {
    if (data) {
      setExpandedPatrols(new Set(data.patrols.map((p) => p.patrol_name)))
    }
  }

  const collapseAll = () => {
    setExpandedPatrols(new Set())
  }

  const handlePrint = () => {
    window.print()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Quick date range presets
  const setThisMonth = () => {
    const now = new Date()
    setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
    setEndDate(now.toISOString().split('T')[0])
  }

  const setThisYear = () => {
    setStartDate(`${currentYear}-01-01`)
    setEndDate(new Date().toISOString().split('T')[0])
  }

  const setLastYear = () => {
    setStartDate(`${currentYear - 1}-01-01`)
    setEndDate(`${currentYear - 1}-12-31`)
  }

  return (
    <Card className="print:shadow-none print:border-0">
      <CardHeader className="print:pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Dues by Patrol</CardTitle>
            <CardDescription className="print:hidden">
              Billing breakdown by patrol for the selected period
            </CardDescription>
            <p className="hidden print:block text-sm text-stone-600 mt-1">
              {unitName} • {formatDate(startDate)} to {formatDate(endDate)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="gap-2 print:hidden"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Date Controls */}
        <div className="flex flex-wrap gap-4 items-end mb-6 print:hidden">
          <div className="flex items-center gap-2">
            <Label htmlFor="duesStartDate" className="text-sm">
              From:
            </Label>
            <Input
              id="duesStartDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-36 h-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="duesEndDate" className="text-sm">
              To:
            </Label>
            <Input
              id="duesEndDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-36 h-8"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={setThisMonth}>
              This Month
            </Button>
            <Button variant="outline" size="sm" onClick={setThisYear}>
              This Year
            </Button>
            <Button variant="outline" size="sm" onClick={setLastYear}>
              Last Year
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="text-stone-500">Loading...</div>
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-error">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Expand/Collapse Controls */}
            <div className="flex gap-2 mb-4 print:hidden">
              <Button variant="ghost" size="sm" onClick={expandAll}>
                Expand All
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll}>
                Collapse All
              </Button>
            </div>

            {/* Patrols Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm font-medium text-stone-500">
                    <th className="pb-3 pr-4 w-8 print:hidden"></th>
                    <th className="pb-3 pr-4">Patrol</th>
                    <th className="pb-3 pr-4 text-center">Scouts</th>
                    <th className="pb-3 pr-4 text-right">Billed</th>
                    <th className="pb-3 pr-4 text-right">Paid</th>
                    <th className="pb-3 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patrols.map((patrol) => {
                    const isExpanded = expandedPatrols.has(patrol.patrol_name)
                    const collectionRate =
                      patrol.total_billed > 0
                        ? (patrol.total_paid / patrol.total_billed) * 100
                        : 100

                    return (
                      <>
                        <tr
                          key={patrol.patrol_name}
                          className={cn(
                            'border-b cursor-pointer hover:bg-stone-50 print:cursor-default print:hover:bg-transparent',
                            isExpanded && 'bg-stone-50 print:bg-transparent'
                          )}
                          onClick={() => togglePatrol(patrol.patrol_name)}
                        >
                          <td className="py-3 pr-2 print:hidden">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-stone-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-stone-400" />
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-stone-400 hidden print:inline-block" />
                              <span className="font-medium text-stone-900">
                                {patrol.patrol_name}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-center text-stone-600">
                            {patrol.scout_count}
                          </td>
                          <td className="py-3 pr-4 text-right text-stone-700 font-mono">
                            {formatCurrency(patrol.total_billed)}
                          </td>
                          <td className="py-3 pr-4 text-right text-success font-mono">
                            {formatCurrency(patrol.total_paid)}
                            <span className="text-xs text-stone-400 ml-1 hidden md:inline">
                              ({collectionRate.toFixed(0)}%)
                            </span>
                          </td>
                          <td
                            className={cn(
                              'py-3 text-right font-medium font-mono',
                              patrol.total_outstanding > 0 ? 'text-error' : 'text-stone-400'
                            )}
                          >
                            {patrol.total_outstanding > 0
                              ? formatCurrency(patrol.total_outstanding)
                              : '—'}
                          </td>
                        </tr>

                        {/* Expanded Scout Details */}
                        {(isExpanded || true) && (
                          <tr
                            className={cn(
                              'print:table-row',
                              !isExpanded && 'hidden print:hidden'
                            )}
                          >
                            <td colSpan={6} className="p-0">
                              <div className="bg-stone-50 print:bg-transparent pl-8 pr-4 py-2">
                                <table className="w-full text-sm">
                                  <tbody>
                                    {patrol.scouts.map((scout) => (
                                      <tr
                                        key={scout.scout_id}
                                        className="border-b border-stone-200 last:border-0"
                                      >
                                        <td className="py-2 pr-4 text-stone-600">
                                          {scout.scout_name}
                                        </td>
                                        <td className="py-2 pr-4 text-right">
                                          <span
                                            className={cn(
                                              'font-mono',
                                              scout.billing_balance < 0
                                                ? 'text-error'
                                                : 'text-stone-400'
                                            )}
                                          >
                                            {scout.billing_balance < 0
                                              ? `Owes ${formatCurrency(Math.abs(scout.billing_balance))}`
                                              : scout.billing_balance > 0
                                                ? `Credit ${formatCurrency(scout.billing_balance)}`
                                                : 'Paid'}
                                          </span>
                                        </td>
                                        <td className="py-2 text-right">
                                          {scout.funds_balance > 0 && (
                                            <span className="text-stone-500 font-mono">
                                              Funds: {formatCurrency(scout.funds_balance)}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-medium">
                    <td className="py-3 pr-2 print:hidden"></td>
                    <td className="py-3 pr-4">Total</td>
                    <td className="py-3 pr-4 text-center">{data.totals.total_scouts}</td>
                    <td className="py-3 pr-4 text-right font-mono">
                      {formatCurrency(data.totals.total_billed)}
                    </td>
                    <td className="py-3 pr-4 text-right text-success font-mono">
                      {formatCurrency(data.totals.total_paid)}
                    </td>
                    <td
                      className={cn(
                        'py-3 text-right font-mono',
                        data.totals.total_outstanding > 0 ? 'text-error' : 'text-stone-400'
                      )}
                    >
                      {data.totals.total_outstanding > 0
                        ? formatCurrency(data.totals.total_outstanding)
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Summary Bar */}
            {data.totals.total_billed > 0 && (
              <div className="mt-6 p-4 bg-stone-50 rounded-lg print:hidden">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-stone-600">Collection Progress</span>
                  <span className="font-medium">
                    {((data.totals.total_paid / data.totals.total_billed) * 100).toFixed(1)}%
                    collected
                  </span>
                </div>
                <div className="h-3 bg-stone-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (data.totals.total_paid / data.totals.total_billed) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-stone-500 mt-1">
                  <span>{formatCurrency(data.totals.total_paid)} collected</span>
                  <span>{formatCurrency(data.totals.total_outstanding)} remaining</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
