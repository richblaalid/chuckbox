'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { Mail, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'
import { BulkReminderDialog } from './bulk-reminder-dialog'

interface OverdueAccount {
  id: string
  billing_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: { name: string } | null
  } | null
  oldest_unpaid_date: string | null
  days_overdue: number
  guardians: {
    profile_id: string
    profiles: {
      id: string
      email: string | null
      first_name: string | null
      last_name: string | null
    } | null
  }[]
}

interface OverdueTableProps {
  accounts: OverdueAccount[]
  unitId: string
  unitName: string
  defaultThresholdDays?: number
}

type DaysFilter = 'all' | '30+' | '60+' | '90+'

// Convert threshold days to initial filter value
function getInitialDaysFilter(thresholdDays: number): DaysFilter {
  if (thresholdDays >= 90) return '90+'
  if (thresholdDays >= 60) return '60+'
  if (thresholdDays >= 30) return '30+'
  return 'all'
}

export function OverdueTable({
  accounts,
  unitId,
  unitName,
  defaultThresholdDays = 30,
}: OverdueTableProps) {
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(() =>
    getInitialDaysFilter(defaultThresholdDays)
  )
  const [minAmountFilter, setMinAmountFilter] = useState('')
  const [patrolFilter, setPatrolFilter] = useState<Set<string>>(new Set())
  const [showReminderDialog, setShowReminderDialog] = useState(false)

  // Get unique patrols for filter
  const patrols = useMemo(() => {
    const patrolSet = new Set<string>()
    accounts.forEach(a => {
      if (a.scouts?.patrols?.name) {
        patrolSet.add(a.scouts.patrols.name)
      }
    })
    return Array.from(patrolSet).sort()
  }, [accounts])

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter(account => {
      // Days filter
      if (daysFilter === '30+' && account.days_overdue < 30) return false
      if (daysFilter === '60+' && account.days_overdue < 60) return false
      if (daysFilter === '90+' && account.days_overdue < 90) return false

      // Amount filter
      const minAmount = parseFloat(minAmountFilter) || 0
      if (minAmount > 0 && Math.abs(account.billing_balance) < minAmount) return false

      // Patrol filter
      if (patrolFilter.size > 0) {
        const patrolName = account.scouts?.patrols?.name || ''
        if (!patrolFilter.has(patrolName)) return false
      }

      return true
    })
  }, [accounts, daysFilter, minAmountFilter, patrolFilter])

  // Selection helpers
  const selectableAccounts = filteredAccounts.filter(a =>
    a.guardians.some(g => g.profiles?.email)
  )

  const allSelected = selectableAccounts.length > 0 &&
    selectableAccounts.every(a => selectedAccounts.has(a.id))

  const someSelected = selectableAccounts.some(a => selectedAccounts.has(a.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelectedAccounts(new Set())
    } else {
      setSelectedAccounts(new Set(selectableAccounts.map(a => a.id)))
    }
  }

  const toggleAccount = (accountId: string) => {
    const newSet = new Set(selectedAccounts)
    if (newSet.has(accountId)) {
      newSet.delete(accountId)
    } else {
      newSet.add(accountId)
    }
    setSelectedAccounts(newSet)
  }

  // Get selected accounts for reminder dialog
  const selectedForReminder = filteredAccounts.filter(a => selectedAccounts.has(a.id))

  // Days overdue badge
  const getDaysOverdueBadge = (days: number) => {
    if (days >= 90) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-error/10 text-error">
          <AlertTriangle className="h-3 w-3" />
          {days} days
        </span>
      )
    }
    if (days >= 60) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
          <Clock className="h-3 w-3" />
          {days} days
        </span>
      )
    }
    if (days >= 30) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
          {days} days
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
        {days} days
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Days overdue filter */}
        <div className="space-y-1">
          <Label className="text-xs text-stone-500">Days Overdue</Label>
          <div className="flex gap-1">
            {(['all', '30+', '60+', '90+'] as DaysFilter[]).map(filter => (
              <Button
                key={filter}
                variant={daysFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDaysFilter(filter)}
                className="h-8"
              >
                {filter === 'all' ? 'All' : filter}
              </Button>
            ))}
          </div>
        </div>

        {/* Min amount filter */}
        <div className="space-y-1">
          <Label className="text-xs text-stone-500">Min Amount</Label>
          <Input
            type="number"
            placeholder="$0"
            value={minAmountFilter}
            onChange={e => setMinAmountFilter(e.target.value)}
            className="w-24 h-8"
          />
        </div>

        {/* Patrol filter */}
        {patrols.length > 0 && (
          <MultiSelectDropdown
            label="Patrol"
            options={patrols}
            selected={patrolFilter}
            onChange={setPatrolFilter}
          />
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Send Reminders button */}
        <Button
          onClick={() => setShowReminderDialog(true)}
          disabled={selectedAccounts.size === 0}
          className="gap-2"
        >
          <Mail className="h-4 w-4" />
          Send Reminders ({selectedAccounts.size})
        </Button>
      </div>

      {/* Results count */}
      <p className="text-sm text-stone-500">
        Showing {filteredAccounts.length} of {accounts.length} overdue accounts
        {selectedAccounts.size > 0 && (
          <span className="ml-2 text-forest-600 font-medium">
            ({selectedAccounts.size} selected)
          </span>
        )}
      </p>

      {/* Table */}
      <ResponsiveTable>
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-stone-500">
              <th className="pb-3 pl-4 w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  disabled={selectableAccounts.length === 0}
                />
              </th>
              <th className="pb-3">Scout</th>
              <th className="pb-3">Patrol</th>
              <th className="pb-3 text-right">Amount</th>
              <th className="pb-3">Overdue</th>
              <th className="pb-3">Guardian</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map(account => {
              const hasEmail = account.guardians.some(g => g.profiles?.email)
              const primaryGuardian = account.guardians.find(g => g.profiles?.email)

              return (
                <tr
                  key={account.id}
                  className="border-b last:border-0 hover:bg-stone-50"
                >
                  <td className="py-3 pl-4">
                    <Checkbox
                      checked={selectedAccounts.has(account.id)}
                      onCheckedChange={() => toggleAccount(account.id)}
                      aria-label={`Select ${account.scouts?.first_name} ${account.scouts?.last_name}`}
                      disabled={!hasEmail}
                    />
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/finances/accounts/${account.id}`}
                      className="font-medium text-forest-600 hover:text-forest-800 hover:underline"
                    >
                      {account.scouts?.first_name} {account.scouts?.last_name}
                    </Link>
                  </td>
                  <td className="py-3 text-stone-600">
                    {account.scouts?.patrols?.name || '—'}
                  </td>
                  <td className="py-3 text-right font-medium text-error">
                    {formatCurrency(Math.abs(account.billing_balance))}
                  </td>
                  <td className="py-3">
                    {getDaysOverdueBadge(account.days_overdue)}
                  </td>
                  <td className="py-3">
                    {hasEmail ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span className="text-sm text-stone-600 truncate max-w-[150px]">
                          {primaryGuardian?.profiles?.first_name || primaryGuardian?.profiles?.email?.split('@')[0]}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-stone-400 italic">No email</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTable>

      {/* Bulk Reminder Dialog */}
      <BulkReminderDialog
        open={showReminderDialog}
        onOpenChange={setShowReminderDialog}
        accounts={selectedForReminder}
        unitId={unitId}
        unitName={unitName}
        onSuccess={() => {
          setSelectedAccounts(new Set())
          setShowReminderDialog(false)
        }}
      />
    </div>
  )
}
