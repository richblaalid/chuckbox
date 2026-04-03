'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Bell,
  Trash2,
  Loader2,
  ClipboardList,
  DollarSign,
} from 'lucide-react'
import { BillingForm } from '@/components/billing/billing-form'
import { BillingRecordActions } from '@/components/billing/billing-record-actions'
import { VoidBillingDialog } from '@/components/billing/void-billing-dialog'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'

// ============================================
// Types
// ============================================

interface ChargeDetail {
  id: string
  amount: number
  is_paid: boolean | null
  is_void: boolean | null
  scout_account_id: string
  scout_first_name: string
  scout_last_name: string
  payment_method: string | null
  check_ref: string | null
}

export interface BillingRecordEntry {
  id: string
  description: string
  billing_date: string
  created_at: string | null
  total_amount: number
  is_void: boolean | null
  batch_id: string | null
  charges: ChargeDetail[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string; billing_balance: number | null; funds_balance: number | null } | null
  patrols: { name: string } | null
}

interface BillingManagementViewProps {
  records: BillingRecordEntry[]
  scouts: Scout[]
  unitId: string
  initialStatus?: StatusFilter
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
}

type StatusFilter = 'all' | 'unpaid' | 'paid' | 'voided'
type SortBy = 'date' | 'amount' | 'description'
type SortOrder = 'asc' | 'desc'

// ============================================
// Component
// ============================================

export function BillingManagementView({ records, scouts, unitId, initialStatus, squareConfig }: BillingManagementViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Read filter state from URL params (with fallbacks)
  const statusFilter = (['all', 'unpaid', 'paid', 'voided'].includes(searchParams.get('status') || '')
    ? searchParams.get('status') as StatusFilter
    : initialStatus || 'all') as StatusFilter
  const dateFrom = searchParams.get('from') || ''
  const dateTo = searchParams.get('to') || ''
  const search = searchParams.get('q') || ''
  const sortBy = (['date', 'amount', 'description'].includes(searchParams.get('sort') || '')
    ? searchParams.get('sort') as SortBy
    : 'date') as SortBy
  const sortOrder = (searchParams.get('order') === 'asc' ? 'asc' : 'desc') as SortOrder

  // Update URL params helper
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || (key === 'status' && value === 'all') || (key === 'sort' && value === 'date') || (key === 'order' && value === 'desc')) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '/finances/billing', { scroll: false })
  }, [searchParams, router])

  const setStatusFilter2 = (v: StatusFilter) => updateParams({ status: v })
  const setDateFrom = (v: string) => updateParams({ from: v })
  const setDateTo = (v: string) => updateParams({ to: v })
  const [searchInput, setSearchInput] = useState(search)
  const commitSearch = () => updateParams({ q: searchInput })
  const setSortBy2 = (v: SortBy) => updateParams({ sort: v })
  const setSortOrder2 = (v: SortOrder) => updateParams({ order: v })

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkNotifying, setIsBulkNotifying] = useState(false)
  const [isBulkVoiding, setIsBulkVoiding] = useState(false)

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Dialog state
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [voidRecord, setVoidRecord] = useState<BillingRecordEntry | null>(null)
  const [notifyResult, setNotifyResult] = useState<{ id: string; sent: number; error?: string } | null>(null)
  const [paymentCharge, setPaymentCharge] = useState<{
    chargeId: string
    scoutAccountId: string
    amount: number
    description: string
  } | null>(null)

  // ============================================
  // Filtering & Sorting
  // ============================================

  const filtered = useMemo(() => {
    let result = [...records]

    // Status filter
    if (statusFilter === 'unpaid') {
      result = result.filter((r) => !r.is_void && r.charges.some((c) => !c.is_paid && !c.is_void))
    } else if (statusFilter === 'paid') {
      result = result.filter((r) => !r.is_void && r.charges.every((c) => c.is_paid || c.is_void))
    } else if (statusFilter === 'voided') {
      result = result.filter((r) => r.is_void)
    }

    // Date range
    if (dateFrom) {
      result = result.filter((r) => r.billing_date >= dateFrom)
    }
    if (dateTo) {
      result = result.filter((r) => r.billing_date <= dateTo)
    }

    // Search (scout name or description)
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter((r) =>
        r.description.toLowerCase().includes(term) ||
        r.charges.some((c) =>
          `${c.scout_first_name} ${c.scout_last_name}`.toLowerCase().includes(term)
        )
      )
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date') {
        const timeA = a.created_at || a.billing_date
        const timeB = b.created_at || b.billing_date
        cmp = timeA.localeCompare(timeB)
      } else if (sortBy === 'amount') {
        cmp = a.total_amount - b.total_amount
      } else if (sortBy === 'description') {
        cmp = a.description.localeCompare(b.description)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })

    return result
  }, [records, statusFilter, dateFrom, dateTo, search, sortBy, sortOrder])

  // ============================================
  // Summary stats (based on ALL records, not filtered)
  // ============================================

  const stats = useMemo(() => {
    const activeRecords = records.filter((r) => !r.is_void)
    const allCharges = activeRecords.flatMap((r) => r.charges).filter((c) => !c.is_void)
    const unpaidCharges = allCharges.filter((c) => !c.is_paid)
    const paidCharges = allCharges.filter((c) => c.is_paid)

    return {
      totalBilled: allCharges.reduce((sum, c) => sum + c.amount, 0),
      totalCollected: paidCharges.reduce((sum, c) => sum + c.amount, 0),
      totalOutstanding: unpaidCharges.reduce((sum, c) => sum + c.amount, 0),
      totalVoided: records.filter((r) => r.is_void).flatMap((r) => r.charges).reduce((sum, c) => sum + c.amount, 0),
    }
  }, [records])

  // ============================================
  // Handlers
  // ============================================

  const toggleSort = (field: SortBy) => {
    if (sortBy === field) {
      setSortOrder2(sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy2(field)
      setSortOrder2('desc')
    }
  }

  const handleActionSuccess = () => {
    setIsBillingOpen(false)
    setVoidRecord(null)
    setSelectedIds(new Set())
    router.refresh()
  }

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)))
    }
  }

  // Bulk actions
  const selectedRecords = filtered.filter((r) => selectedIds.has(r.id))
  const selectedWithUnpaid = selectedRecords.filter(
    (r) => !r.is_void && r.charges.some((c) => !c.is_paid && !c.is_void)
  )
  const selectedNonVoided = selectedRecords.filter((r) => !r.is_void)

  const handleBulkNotify = async () => {
    setIsBulkNotifying(true)
    let totalSent = 0

    for (const record of selectedWithUnpaid) {
      try {
        const response = await fetch(`/api/billing-records/${record.id}/notify`, {
          method: 'POST',
        })
        if (response.ok) {
          const data = await response.json()
          totalSent += data.notificationsSent || 0
        }
      } catch {
        // Continue with remaining records
      }
    }

    setNotifyResult({
      id: 'bulk',
      sent: totalSent,
      error: totalSent === 0 ? 'No notifications sent' : undefined,
    })
    setIsBulkNotifying(false)
    setSelectedIds(new Set())
  }

  const handleBulkVoid = async () => {
    setIsBulkVoiding(true)

    for (const record of selectedNonVoided) {
      try {
        const { voidBillingRecord } = await import('@/app/actions/billing')
        await voidBillingRecord(record.id)
      } catch {
        // Continue with remaining records
      }
    }

    setIsBulkVoiding(false)
    setSelectedIds(new Set())
    router.refresh()
  }

  const handleRecordPaymentForCharge = (charge: ChargeDetail, description: string) => {
    setPaymentCharge({
      chargeId: charge.id,
      scoutAccountId: charge.scout_account_id,
      amount: charge.amount,
      description,
    })
  }

  const paymentScout = paymentCharge
    ? scouts.find(s => s.scout_accounts?.id === paymentCharge.scoutAccountId)
    : null

  const getRecordStatus = (record: BillingRecordEntry): 'voided' | 'paid' | 'partial' | 'unpaid' => {
    if (record.is_void) return 'voided'
    const activeCharges = record.charges.filter((c) => !c.is_void)
    if (activeCharges.length === 0) return 'paid'
    const paidCount = activeCharges.filter((c) => c.is_paid).length
    if (paidCount === activeCharges.length) return 'paid'
    if (paidCount > 0) return 'partial'
    return 'unpaid'
  }

  const statusBadge = (status: ReturnType<typeof getRecordStatus>) => {
    switch (status) {
      case 'paid':
        return <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Paid</Badge>
      case 'partial':
        return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Partial</Badge>
      case 'unpaid':
        return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Unpaid</Badge>
      case 'voided':
        return <Badge variant="outline" className="border-stone-200 text-stone-400">Voided</Badge>
    }
  }

  // Scouts formatted for BillingForm
  const scoutsForBilling = scouts.map((s) => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    is_active: s.is_active,
    scout_accounts: s.scout_accounts ? { id: s.scout_accounts.id } : null,
    patrols: s.patrols,
  }))

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Billed</CardDescription>
            <CardTitle className="text-2xl text-stone-700">{formatCurrency(stats.totalBilled)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Collected</CardDescription>
            <CardTitle className="text-2xl text-green-600">{formatCurrency(stats.totalCollected)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Outstanding</CardDescription>
            <CardTitle className="text-2xl text-error">{formatCurrency(stats.totalOutstanding)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Voided</CardDescription>
            <CardTitle className="text-2xl text-stone-400">{formatCurrency(stats.totalVoided)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
            {/* Status Filter */}
            <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 gap-1">
              {(['all', 'unpaid', 'paid', 'voided'] as StatusFilter[]).map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter2(s)}
                  className="capitalize"
                >
                  {s}
                </Button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input
                placeholder="Search by scout name or description..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onBlur={commitSearch}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSearch() }}
                className="pl-9"
              />
            </div>

            {/* Date Range */}
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
                placeholder="From"
              />
              <span className="text-stone-400">–</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
                placeholder="To"
              />
            </div>

            {/* Create Billing */}
            <Button variant="default" className="gap-2" onClick={() => setIsBillingOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Billing
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-forest-200 bg-forest-50 p-3">
          <p className="text-sm font-medium text-forest-900">
            {selectedIds.size} record{selectedIds.size !== 1 ? 's' : ''} selected
          </p>
          <div className="flex items-center gap-2">
            {selectedWithUnpaid.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={handleBulkNotify}
                disabled={isBulkNotifying}
              >
                {isBulkNotifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bell className="h-4 w-4" />
                )}
                Send Reminders ({selectedWithUnpaid.length})
              </Button>
            )}
            {selectedNonVoided.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1"
                onClick={handleBulkVoid}
                disabled={isBulkVoiding}
              >
                {isBulkVoiding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Void ({selectedNonVoided.length})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Bulk notification feedback */}
      {notifyResult?.id === 'bulk' && (
        <div className={`rounded-md p-3 text-sm ${
          notifyResult.error
            ? 'bg-red-50 text-red-700'
            : 'bg-green-50 text-green-700'
        }`}>
          {notifyResult.error
            ? `Error: ${notifyResult.error}`
            : `${notifyResult.sent} reminder${notifyResult.sent !== 1 ? 's' : ''} sent across selected records`}
        </div>
      )}

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-forest-600" />
                Billing Records
              </CardTitle>
              <CardDescription>
                {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                {statusFilter !== 'all' ? ` (${statusFilter})` : ''}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length > 0 ? (
            <div className="space-y-2">
              {/* Column Headers */}
              <div className="hidden sm:flex items-center gap-4 px-3 pb-2 text-xs font-medium uppercase tracking-wider text-stone-500 border-b">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-stone-300"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                />
                <div className="w-6" />
                <button
                  className="flex-1 text-left hover:text-stone-900"
                  onClick={() => toggleSort('description')}
                >
                  Description {sortBy === 'description' && (sortOrder === 'desc' ? '↓' : '↑')}
                </button>
                <button
                  className="w-28 text-left hover:text-stone-900"
                  onClick={() => toggleSort('date')}
                >
                  Date {sortBy === 'date' && (sortOrder === 'desc' ? '↓' : '↑')}
                </button>
                <div className="w-20 text-center">Status</div>
                <div className="w-16 text-center">Scouts</div>
                <button
                  className="w-24 text-right hover:text-stone-900"
                  onClick={() => toggleSort('amount')}
                >
                  Amount {sortBy === 'amount' && (sortOrder === 'desc' ? '↓' : '↑')}
                </button>
                <div className="w-28" />
              </div>

              {/* Rows */}
              {filtered.map((record) => {
                const isExpanded = expandedId === record.id
                const status = getRecordStatus(record)
                const activeCharges = record.charges.filter((c) => !c.is_void)
                const paidCount = activeCharges.filter((c) => c.is_paid).length
                const hasUnpaid = activeCharges.some((c) => !c.is_paid)

                return (
                  <div key={record.id} className="rounded-lg border border-stone-200">
                    {/* Record Row */}
                    <div className="flex items-center gap-4 p-3">
                      <input
                        type="checkbox"
                        className="hidden sm:block h-4 w-4 rounded border-stone-300"
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                      />
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : record.id)}
                        className="text-stone-400 hover:text-stone-600"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${record.is_void ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                          {record.description}
                        </p>
                        <p className="text-xs text-stone-500 sm:hidden">
                          {new Date(record.billing_date + 'T00:00:00').toLocaleDateString()} · {paidCount}/{activeCharges.length} paid
                        </p>
                      </div>

                      <div className="hidden sm:block w-28 text-sm text-stone-600">
                        {new Date(record.billing_date + 'T00:00:00').toLocaleDateString()}
                      </div>

                      <div className="hidden sm:flex w-20 justify-center">
                        {statusBadge(status)}
                      </div>

                      <div className="hidden sm:block w-16 text-center text-sm text-stone-600">
                        {paidCount}/{activeCharges.length}
                      </div>

                      <div className={`w-24 text-right text-sm font-medium ${record.is_void ? 'text-stone-400' : 'text-stone-900'}`}>
                        {formatCurrency(record.total_amount)}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 w-28 justify-end">
                        <BillingRecordActions
                          billingRecordId={record.id}
                          description={record.description}
                          totalAmount={record.total_amount}
                          isVoid={record.is_void ?? false}
                          hasPaidCharges={record.charges.some((c) => c.is_paid && !c.is_void)}
                          hasUnpaidCharges={hasUnpaid}
                          canEdit={true}
                          canVoid={true}
                        />
                      </div>
                    </div>

                    {/* Expanded Charges */}
                    {isExpanded && (
                      <div className="border-t border-stone-100 px-3 pb-3">
                        <div className="mt-2 space-y-1.5">
                          {record.charges
                            .sort((a, b) => `${a.scout_last_name} ${a.scout_first_name}`.localeCompare(`${b.scout_last_name} ${b.scout_first_name}`))
                            .map((charge) => (
                              <div
                                key={charge.id}
                                className="flex items-center justify-between py-1.5 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/finances/accounts/${charge.scout_account_id}`}
                                    className="text-forest-600 hover:text-forest-800 hover:underline"
                                  >
                                    {charge.scout_first_name} {charge.scout_last_name}
                                  </Link>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={charge.is_paid ? 'text-stone-400 line-through' : 'text-stone-900'}>
                                    {formatCurrency(charge.amount)}
                                  </span>
                                  {charge.is_void ? (
                                    <Badge variant="outline" className="border-stone-200 text-stone-400 text-xs px-1.5 py-0">
                                      Voided
                                    </Badge>
                                  ) : charge.is_paid ? (
                                    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs px-1.5 py-0">
                                      Paid
                                      {charge.payment_method && (
                                        <span className="text-green-500 font-normal">
                                          {' · '}{charge.payment_method === 'check' && charge.check_ref
                                            ? `Check #${charge.check_ref}`
                                            : charge.payment_method === 'check'
                                              ? 'Check'
                                              : charge.payment_method === 'card'
                                                ? 'Card'
                                                : charge.payment_method.charAt(0).toUpperCase() + charge.payment_method.slice(1)}
                                        </span>
                                      )}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs px-1.5 py-0">
                                      Unpaid
                                    </Badge>
                                  )}
                                  {!charge.is_void && !charge.is_paid && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-forest-600 hover:text-forest-800"
                                      onClick={() => handleRecordPaymentForCharge(charge, record.description)}
                                    >
                                      <DollarSign className="h-3 w-3 mr-1" />
                                      Record Payment
                                    </Button>
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
            <p className="py-8 text-center text-sm text-stone-500">
              {records.length === 0
                ? 'No billing records yet. Create your first billing charge.'
                : 'No billing records match your filters.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create Billing Dialog */}
      <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create Billing</DialogTitle>
          </DialogHeader>
          <BillingForm unitId={unitId} scouts={scoutsForBilling} onSuccess={handleActionSuccess} />
        </DialogContent>
      </Dialog>

      {/* Void Billing Dialog */}
      {voidRecord && (
        <VoidBillingDialog
          open={!!voidRecord}
          onOpenChange={(open) => { if (!open) { setVoidRecord(null); router.refresh() } }}
          billingRecordId={voidRecord.id}
          description={voidRecord.description}
          amount={voidRecord.total_amount}
          type="record"
        />
      )}

      {/* Record Payment for Charge Dialog */}
      {paymentCharge && paymentScout && (
        <Dialog open={!!paymentCharge} onOpenChange={(open) => { if (!open) setPaymentCharge(null) }}>
          <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                Record Payment for: {paymentCharge.description}
              </DialogTitle>
            </DialogHeader>
            <QuickPaymentForm
              unitId={unitId}
              scouts={[paymentScout]}
              squareConfig={squareConfig}
              preselectedScoutId={paymentScout.id}
              initialAmount={paymentCharge.amount}
              initialChargeId={paymentCharge.chargeId}
              lockedScoutId
              onSuccess={() => {
                setPaymentCharge(null)
                router.refresh()
              }}
              onCancel={() => setPaymentCharge(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
