'use client'

import Link from 'next/link'
import { DollarSign, Bell, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResponsiveTable, tableStyles } from '@/components/ui/responsive-table'
import { formatCurrency, cn } from '@/lib/utils'

export interface ScoutOwing {
  scoutId: string
  scoutAccountId: string
  scoutName: string
  amountOwed: number
  lastPaymentDate: string | null
  daysOverdue: number
}

interface ScoutsOwingTableProps {
  scouts: ScoutOwing[]
  onRecordPayment: (scoutAccountId: string) => void
  onSendReminder: (scoutAccountId: string) => void
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function DaysOverdueBadge({ days }: { days: number }) {
  const isOverdue = days >= 30
  return (
    <span
      className={cn(
        'text-sm font-medium',
        isOverdue ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-400'
      )}
    >
      {days}d
    </span>
  )
}

export function ScoutsOwingTable({ scouts, onRecordPayment, onSendReminder }: ScoutsOwingTableProps) {
  if (scouts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scouts Owing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">All scouts are paid up!</span>
          </div>
        </CardContent>
        <CardFooter>
          <Link
            href="/finances/accounts"
            className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300"
          >
            View all accounts →
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scouts Owing</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ResponsiveTable>
          <table className={tableStyles.table}>
            <thead className={tableStyles.thead}>
              <tr className="bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700">
                <th className="py-3 pl-6 pr-4 font-medium">Scout Name</th>
                <th className={cn('py-3 pr-4 font-medium', tableStyles.textRight)}>Amount Owed</th>
                <th className={cn('py-3 pr-4 font-medium', tableStyles.hiddenSm)}>Last Payment</th>
                <th className={cn('py-3 pr-4 font-medium', tableStyles.hiddenMd)}>Days Overdue</th>
                <th className="py-3 pr-6 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {scouts.map((scout) => (
                <tr
                  key={scout.scoutAccountId}
                  className={cn(tableStyles.tr, 'hover:bg-stone-50 dark:hover:bg-stone-800/50')}
                >
                  <td className={cn(tableStyles.td, 'pl-6 font-medium')}>
                    <Link
                      href={`/finances/accounts/${scout.scoutAccountId}`}
                      className="text-forest-600 hover:text-forest-800 hover:underline dark:text-forest-400 dark:hover:text-forest-300"
                    >
                      {scout.scoutName}
                    </Link>
                  </td>
                  <td className={cn(tableStyles.td, tableStyles.textRight, 'text-red-600 font-medium dark:text-red-400')}>
                    {formatCurrency(scout.amountOwed)}
                  </td>
                  <td className={cn(tableStyles.td, tableStyles.hiddenSm, 'text-stone-500 dark:text-stone-400 text-sm')}>
                    {formatDate(scout.lastPaymentDate)}
                  </td>
                  <td className={cn(tableStyles.td, tableStyles.hiddenMd)}>
                    <DaysOverdueBadge days={scout.daysOverdue} />
                  </td>
                  <td className={cn(tableStyles.td, 'pr-6 text-right')}>
                    <div className="flex items-center justify-end gap-1">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onRecordPayment(scout.scoutAccountId)}
                              aria-label={`Record payment for ${scout.scoutName}`}
                              className="h-7 w-7 p-0"
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Record Payment</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onSendReminder(scout.scoutAccountId)}
                              aria-label={`Send reminder to ${scout.scoutName}`}
                              className="h-7 w-7 p-0"
                            >
                              <Bell className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Send Reminder</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </CardContent>
      <CardFooter className="pt-4">
        <Link
          href="/finances/accounts"
          className="text-sm text-forest-600 hover:text-forest-800 dark:text-forest-400 dark:hover:text-forest-300"
        >
          View all accounts →
        </Link>
      </CardFooter>
    </Card>
  )
}
