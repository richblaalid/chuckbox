'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatCurrency, cn } from '@/lib/utils'
import { Loader2, TrendingUp, TrendingDown, Printer } from 'lucide-react'

interface AccountBalance {
  account_id: string
  account_name: string
  account_code: string
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  balance: number
}

interface IncomeExpenseData {
  startDate: string
  endDate: string
  income: AccountBalance[]
  expenses: AccountBalance[]
  totals: {
    totalIncome: number
    totalExpenses: number
    netIncome: number
  }
}

interface IncomeExpenseReportProps {
  unitName: string
}

export function IncomeExpenseReport({ unitName }: IncomeExpenseReportProps) {
  // Default to current year
  const currentYear = new Date().getFullYear()
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`)
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<IncomeExpenseData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async (start: string, end: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/reports/income-expense?startDate=${start}&endDate=${end}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch income/expense report')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load income/expense report')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData(startDate, endDate)
  }, [startDate, endDate])

  const handlePrint = () => {
    window.print()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // Quick date range presets
  const setThisYear = () => {
    setStartDate(`${currentYear}-01-01`)
    setEndDate(new Date().toISOString().split('T')[0])
  }

  const setLastYear = () => {
    setStartDate(`${currentYear - 1}-01-01`)
    setEndDate(`${currentYear - 1}-12-31`)
  }

  const setThisMonth = () => {
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    setStartDate(firstOfMonth.toISOString().split('T')[0])
    setEndDate(today.toISOString().split('T')[0])
  }

  const setLastMonth = () => {
    const today = new Date()
    const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)
    setStartDate(firstOfLastMonth.toISOString().split('T')[0])
    setEndDate(lastOfLastMonth.toISOString().split('T')[0])
  }

  return (
    <Card className="print:shadow-none print:border-0">
      <CardHeader className="print:pb-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 print:hidden" />
              Income & Expense Statement
            </CardTitle>
            <CardDescription className="print:hidden">
              Revenue and expenses for a date range
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <Label htmlFor="startDate" className="text-sm whitespace-nowrap">
                From:
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="endDate" className="text-sm whitespace-nowrap">
                To:
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-36"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
        {/* Quick presets */}
        <div className="flex flex-wrap gap-2 mt-3 print:hidden">
          <Button variant="ghost" size="sm" onClick={setThisMonth}>This Month</Button>
          <Button variant="ghost" size="sm" onClick={setLastMonth}>Last Month</Button>
          <Button variant="ghost" size="sm" onClick={setThisYear}>This Year</Button>
          <Button variant="ghost" size="sm" onClick={setLastYear}>Last Year</Button>
        </div>
        {/* Print header */}
        <div className="hidden print:block text-center mt-4">
          <h1 className="text-2xl font-bold">{unitName}</h1>
          <h2 className="text-xl">Income & Expense Statement</h2>
          <p className="text-sm text-stone-600">
            {data ? `${formatDate(data.startDate)} to ${formatDate(data.endDate)}` : ''}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-error">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => fetchData(startDate, endDate)}>
              Try Again
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Income Section */}
            <div>
              <h3 className="text-lg font-semibold text-success border-b-2 border-success pb-1 mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Income
              </h3>
              {data.income.length > 0 ? (
                <div className="space-y-1 pl-4">
                  {data.income.map((account) => (
                    <div key={account.account_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">
                        <span className="text-stone-400 mr-2">{account.account_code}</span>
                        {account.account_name}
                      </span>
                      <span className="font-mono text-success">{formatCurrency(account.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500 pl-4 italic">No income recorded for this period</p>
              )}
              <div className="flex justify-between font-semibold text-success mt-2 pt-2 border-t">
                <span>Total Income</span>
                <span className="font-mono">{formatCurrency(data.totals.totalIncome)}</span>
              </div>
            </div>

            {/* Expenses Section */}
            <div>
              <h3 className="text-lg font-semibold text-error border-b-2 border-error pb-1 mb-3 flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Expenses
              </h3>
              {data.expenses.length > 0 ? (
                <div className="space-y-1 pl-4">
                  {data.expenses.map((account) => (
                    <div key={account.account_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">
                        <span className="text-stone-400 mr-2">{account.account_code}</span>
                        {account.account_name}
                      </span>
                      <span className="font-mono text-error">{formatCurrency(account.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500 pl-4 italic">No expenses recorded for this period</p>
              )}
              <div className="flex justify-between font-semibold text-error mt-2 pt-2 border-t">
                <span>Total Expenses</span>
                <span className="font-mono">{formatCurrency(data.totals.totalExpenses)}</span>
              </div>
            </div>

            {/* Net Income */}
            <div className="border-t-2 border-stone-900 pt-3">
              <div className={cn(
                'flex justify-between font-bold text-lg',
                data.totals.netIncome >= 0 ? 'text-success' : 'text-error'
              )}>
                <span>Net {data.totals.netIncome >= 0 ? 'Income' : 'Loss'}</span>
                <span className="font-mono">{formatCurrency(Math.abs(data.totals.netIncome))}</span>
              </div>
            </div>

            {/* Summary Bar */}
            {(data.totals.totalIncome > 0 || data.totals.totalExpenses > 0) && (
              <div className="pt-4 print:hidden">
                <div className="text-xs text-stone-500 mb-2">Income vs Expenses</div>
                <div className="flex h-6 rounded-lg overflow-hidden">
                  {data.totals.totalIncome > 0 && (
                    <div
                      className="bg-success/20 flex items-center justify-center text-xs font-medium text-success"
                      style={{
                        width: `${(data.totals.totalIncome / (data.totals.totalIncome + data.totals.totalExpenses)) * 100}%`
                      }}
                    >
                      {((data.totals.totalIncome / (data.totals.totalIncome + data.totals.totalExpenses)) * 100).toFixed(0)}%
                    </div>
                  )}
                  {data.totals.totalExpenses > 0 && (
                    <div
                      className="bg-error/20 flex items-center justify-center text-xs font-medium text-error"
                      style={{
                        width: `${(data.totals.totalExpenses / (data.totals.totalIncome + data.totals.totalExpenses)) * 100}%`
                      }}
                    >
                      {((data.totals.totalExpenses / (data.totals.totalIncome + data.totals.totalExpenses)) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
