'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { Loader2, FileText, Printer } from 'lucide-react'

interface AccountBalance {
  account_id: string
  account_name: string
  account_code: string
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  balance: number
}

interface BalanceSheetData {
  asOfDate: string
  assets: AccountBalance[]
  liabilities: AccountBalance[]
  equity: AccountBalance[]
  totals: {
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    netIncome: number
  }
}

interface BalanceSheetReportProps {
  unitName: string
}

export function BalanceSheetReport({ unitName }: BalanceSheetReportProps) {
  const [asOfDate, setAsOfDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async (date: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/reports/balance-sheet?asOfDate=${date}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch balance sheet')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balance sheet')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData(asOfDate)
  }, [asOfDate])

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

  // Check if balance sheet balances (Assets = Liabilities + Equity + Net Income)
  const isBalanced = data
    ? Math.abs(data.totals.totalAssets - (data.totals.totalLiabilities + data.totals.totalEquity + data.totals.netIncome)) < 0.01
    : false

  return (
    <Card className="print:shadow-none print:border-0">
      <CardHeader className="print:pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 print:hidden" />
              Balance Sheet
            </CardTitle>
            <CardDescription className="print:hidden">
              Financial position as of a specific date
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <Label htmlFor="asOfDate" className="text-sm whitespace-nowrap">
                As of:
              </Label>
              <Input
                id="asOfDate"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
        {/* Print header */}
        <div className="hidden print:block text-center mt-4">
          <h1 className="text-2xl font-bold">{unitName}</h1>
          <h2 className="text-xl">Balance Sheet</h2>
          <p className="text-sm text-stone-600">As of {data ? formatDate(data.asOfDate) : ''}</p>
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
            <Button variant="outline" className="mt-4" onClick={() => fetchData(asOfDate)}>
              Try Again
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Assets Section */}
            <div>
              <h3 className="text-lg font-semibold text-stone-900 border-b-2 border-stone-900 pb-1 mb-3">
                Assets
              </h3>
              {data.assets.length > 0 ? (
                <div className="space-y-1 pl-4">
                  {data.assets.map((account) => (
                    <div key={account.account_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">
                        <span className="text-stone-400 mr-2">{account.account_code}</span>
                        {account.account_name}
                      </span>
                      <span className="font-mono">{formatCurrency(account.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500 pl-4 italic">No asset accounts with balances</p>
              )}
              <div className="flex justify-between font-semibold text-stone-900 mt-2 pt-2 border-t">
                <span>Total Assets</span>
                <span className="font-mono">{formatCurrency(data.totals.totalAssets)}</span>
              </div>
            </div>

            {/* Liabilities Section */}
            <div>
              <h3 className="text-lg font-semibold text-stone-900 border-b-2 border-stone-900 pb-1 mb-3">
                Liabilities
              </h3>
              {data.liabilities.length > 0 ? (
                <div className="space-y-1 pl-4">
                  {data.liabilities.map((account) => (
                    <div key={account.account_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">
                        <span className="text-stone-400 mr-2">{account.account_code}</span>
                        {account.account_name}
                      </span>
                      <span className="font-mono">{formatCurrency(account.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500 pl-4 italic">No liability accounts with balances</p>
              )}
              <div className="flex justify-between font-semibold text-stone-900 mt-2 pt-2 border-t">
                <span>Total Liabilities</span>
                <span className="font-mono">{formatCurrency(data.totals.totalLiabilities)}</span>
              </div>
            </div>

            {/* Equity Section */}
            <div>
              <h3 className="text-lg font-semibold text-stone-900 border-b-2 border-stone-900 pb-1 mb-3">
                Equity
              </h3>
              {data.equity.length > 0 ? (
                <div className="space-y-1 pl-4">
                  {data.equity.map((account) => (
                    <div key={account.account_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">
                        <span className="text-stone-400 mr-2">{account.account_code}</span>
                        {account.account_name}
                      </span>
                      <span className="font-mono">{formatCurrency(account.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500 pl-4 italic">No equity accounts with balances</p>
              )}
              {/* Net Income (Retained Earnings) */}
              <div className="flex justify-between text-sm pl-4 mt-1">
                <span className="text-stone-700 italic">Net Income (Current Period)</span>
                <span className="font-mono">{formatCurrency(data.totals.netIncome)}</span>
              </div>
              <div className="flex justify-between font-semibold text-stone-900 mt-2 pt-2 border-t">
                <span>Total Equity</span>
                <span className="font-mono">
                  {formatCurrency(data.totals.totalEquity + data.totals.netIncome)}
                </span>
              </div>
            </div>

            {/* Total Liabilities + Equity */}
            <div className="border-t-2 border-stone-900 pt-3">
              <div className="flex justify-between font-bold text-lg text-stone-900">
                <span>Total Liabilities + Equity</span>
                <span className="font-mono">
                  {formatCurrency(data.totals.totalLiabilities + data.totals.totalEquity + data.totals.netIncome)}
                </span>
              </div>
            </div>

            {/* Balance Check */}
            <div className={`text-center text-sm ${isBalanced ? 'text-success' : 'text-error'} print:hidden`}>
              {isBalanced ? (
                <span>Balance sheet is balanced</span>
              ) : (
                <span>
                  Warning: Balance sheet is out of balance by{' '}
                  {formatCurrency(Math.abs(data.totals.totalAssets - (data.totals.totalLiabilities + data.totals.totalEquity + data.totals.netIncome)))}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
