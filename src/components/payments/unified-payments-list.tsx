'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'
import { PaymentDetailSheet } from '@/components/payments/payment-detail-sheet'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  RefreshCw,
  Banknote,
  FileText,
  CreditCard,
  ArrowUpDown,
  Search,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentRow {
  type: 'payment'
  id: string
  amount: number
  fee_amount: number | null
  net_amount: number
  payment_method: string | null
  status: string | null
  created_at: string | null
  notes: string | null
  square_payment_id: string | null
  square_receipt_url: string | null
  journal_entry_id: string | null
  scout_account_id: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  recorded_by: string | null
  reconciliation_status: string | null
  scout_name: string | null
  recorded_by_name: string | null
  voided_by_name: string | null
}

export interface UnreconciledRow {
  type: 'unreconciled_square'
  id: string
  square_payment_id: string
  amount_money: number
  fee_money: number | null
  net_money: number
  currency: string | null
  status: string
  card_brand: string | null
  last_4: string | null
  receipt_url: string | null
  receipt_number: string | null
  square_created_at: string
  buyer_email_address: string | null
  cardholder_name: string | null
  note: string | null
}

export type UnifiedRow = PaymentRow | UnreconciledRow

// ── Props types from Supabase joins ────────────────────────────────────────

interface PaymentFromDB {
  id: string
  amount: number
  fee_amount: number | null
  net_amount: number
  payment_method: string | null
  status: string | null
  created_at: string | null
  notes: string | null
  square_payment_id: string | null
  square_receipt_url: string | null
  journal_entry_id: string | null
  scout_account_id: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  recorded_by: string | null
  reconciliation_status: string | null
  scout_account: {
    id: string
    scout: { id: string; first_name: string; last_name: string } | null
  } | null
}

interface SquareTransactionFromDB {
  id: string
  square_payment_id: string
  amount_money: number
  fee_money: number | null
  net_money: number
  currency: string | null
  status: string
  card_brand: string | null
  last_4: string | null
  receipt_url: string | null
  receipt_number: string | null
  square_created_at: string
  buyer_email_address: string | null
  cardholder_name: string | null
  note: string | null
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance: number | null
  } | null
}

interface UnifiedPaymentsListProps {
  payments: PaymentFromDB[]
  recordedByMap: Record<string, string>
  voidedByMap: Record<string, string>
  unreconciledSquareTransactions: SquareTransactionFromDB[]
  hasSquareConnection: boolean
  scouts: Scout[]
  unitId: string
  userRole: string
}

// ── Filter types ───────────────────────────────────────────────────────────

type MethodFilter = 'all' | 'cash' | 'check' | 'card' | 'square'
type StatusFilter = 'all' | 'completed' | 'voided' | 'needs_reconciliation'
type DateRangeFilter = '7d' | '30d' | '90d' | 'ytd' | 'all'
type SortField = 'date' | 'scout' | 'amount' | 'method' | 'status' | 'recorded_by'
type SortDirection = 'asc' | 'desc'

// ── Helpers ────────────────────────────────────────────────────────────────

function getRowDate(row: UnifiedRow): string {
  if (row.type === 'payment') {
    return row.created_at || ''
  }
  return row.square_created_at
}

function getRowAmount(row: UnifiedRow): number {
  if (row.type === 'payment') {
    return row.amount
  }
  // Square amounts are in cents
  return row.amount_money / 100
}

function getRowScoutName(row: UnifiedRow): string {
  if (row.type === 'payment') {
    return row.scout_name || ''
  }
  return row.cardholder_name || ''
}

function getRowMethod(row: UnifiedRow): string {
  if (row.type === 'payment') {
    return row.payment_method || 'unknown'
  }
  return 'square'
}

function getRowStatus(row: UnifiedRow): string {
  if (row.type === 'payment') {
    if (row.voided_at) return 'voided'
    return row.status || 'completed'
  }
  return 'needs_reconciliation'
}

function getRowRecordedBy(row: UnifiedRow): string {
  if (row.type === 'payment') {
    return row.recorded_by_name || ''
  }
  return 'Square'
}

function getDateCutoff(range: DateRangeFilter): Date | null {
  if (range === 'all') return null
  const now = new Date()
  if (range === 'ytd') {
    return new Date(now.getFullYear(), 0, 1)
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff
}

function getMethodIcon(method: string) {
  switch (method.toLowerCase()) {
    case 'cash':
      return <Banknote className="h-4 w-4 text-stone-500" />
    case 'check':
      return <FileText className="h-4 w-4 text-stone-500" />
    case 'card':
    case 'square':
      return <CreditCard className="h-4 w-4 text-stone-500" />
    default:
      return null
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return (
        <span className="rounded-md px-2 py-1 text-xs font-medium bg-success-light text-success">
          Completed
        </span>
      )
    case 'voided':
      return (
        <span className="rounded-md px-2 py-1 text-xs font-medium bg-error-light text-error">
          Voided
        </span>
      )
    case 'needs_reconciliation':
      return (
        <span className="rounded-md px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700">
          Needs Reconciliation
        </span>
      )
    default:
      return (
        <span className="rounded-md px-2 py-1 text-xs font-medium bg-stone-100 text-stone-600 capitalize">
          {status}
        </span>
      )
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export function UnifiedPaymentsList({
  payments,
  recordedByMap,
  voidedByMap,
  unreconciledSquareTransactions,
  hasSquareConnection,
  scouts,
  unitId,
  userRole,
}: UnifiedPaymentsListProps) {
  const router = useRouter()

  // Filter state
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateRange, setDateRange] = useState<DateRangeFilter>('30d')
  const [searchQuery, setSearchQuery] = useState('')

  // Sort state
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Row selection state (for future PaymentDetailSheet)
  const [selectedRow, setSelectedRow] = useState<UnifiedRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Build unified rows
  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    const paymentRows: PaymentRow[] = payments.map((p) => {
      const scoutAccount = p.scout_account
      let scoutName: string | null = null
      if (scoutAccount && scoutAccount.scout) {
        scoutName = `${scoutAccount.scout.first_name} ${scoutAccount.scout.last_name}`
      }

      return {
        type: 'payment' as const,
        id: p.id,
        amount: p.amount,
        fee_amount: p.fee_amount,
        net_amount: p.net_amount,
        payment_method: p.payment_method,
        status: p.status,
        created_at: p.created_at,
        notes: p.notes,
        square_payment_id: p.square_payment_id,
        square_receipt_url: p.square_receipt_url,
        journal_entry_id: p.journal_entry_id,
        scout_account_id: p.scout_account_id,
        voided_at: p.voided_at,
        voided_by: p.voided_by,
        void_reason: p.void_reason,
        recorded_by: p.recorded_by,
        reconciliation_status: p.reconciliation_status,
        scout_name: scoutName,
        recorded_by_name: p.recorded_by ? recordedByMap[p.recorded_by] || 'Unknown' : null,
        voided_by_name: p.voided_by ? voidedByMap[p.voided_by] || 'Unknown' : null,
      }
    })

    const unreconciledRows: UnreconciledRow[] = unreconciledSquareTransactions.map((t) => ({
      type: 'unreconciled_square' as const,
      id: t.id,
      square_payment_id: t.square_payment_id,
      amount_money: t.amount_money,
      fee_money: t.fee_money,
      net_money: t.net_money,
      currency: t.currency,
      status: t.status,
      card_brand: t.card_brand,
      last_4: t.last_4,
      receipt_url: t.receipt_url,
      receipt_number: t.receipt_number,
      square_created_at: t.square_created_at,
      buyer_email_address: t.buyer_email_address,
      cardholder_name: t.cardholder_name,
      note: t.note,
    }))

    return [...paymentRows, ...unreconciledRows]
  }, [payments, unreconciledSquareTransactions, recordedByMap, voidedByMap])

  // Apply filters and sorting
  const filteredRows = useMemo(() => {
    let rows = unifiedRows

    // Method filter
    if (methodFilter !== 'all') {
      rows = rows.filter((row) => {
        const method = getRowMethod(row).toLowerCase()
        if (methodFilter === 'square') {
          return row.type === 'unreconciled_square' || method === 'card'
        }
        return method === methodFilter
      })
    }

    // Status filter
    if (statusFilter !== 'all') {
      rows = rows.filter((row) => {
        const status = getRowStatus(row)
        return status === statusFilter
      })
    }

    // Date range filter
    const cutoff = getDateCutoff(dateRange)
    if (cutoff) {
      rows = rows.filter((row) => {
        const dateStr = getRowDate(row)
        if (!dateStr) return false
        return new Date(dateStr) >= cutoff
      })
    }

    // Search filter (scout name)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      rows = rows.filter((row) => {
        const name = getRowScoutName(row).toLowerCase()
        if (name.includes(query)) return true
        // Also search notes
        if (row.type === 'payment' && row.notes?.toLowerCase().includes(query)) return true
        if (row.type === 'unreconciled_square' && row.note?.toLowerCase().includes(query))
          return true
        return false
      })
    }

    // Sorting
    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date': {
          const dateA = getRowDate(a)
          const dateB = getRowDate(b)
          cmp = dateA.localeCompare(dateB)
          break
        }
        case 'scout':
          cmp = getRowScoutName(a).localeCompare(getRowScoutName(b))
          break
        case 'amount':
          cmp = getRowAmount(a) - getRowAmount(b)
          break
        case 'method':
          cmp = getRowMethod(a).localeCompare(getRowMethod(b))
          break
        case 'status':
          cmp = getRowStatus(a).localeCompare(getRowStatus(b))
          break
        case 'recorded_by':
          cmp = getRowRecordedBy(a).localeCompare(getRowRecordedBy(b))
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })

    return rows
  }, [unifiedRows, methodFilter, statusFilter, dateRange, searchQuery, sortField, sortDirection])

  // Sort toggle handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Sync handler
  const handleSync = async () => {
    setIsSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/square/sync', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync transactions')
      }
      router.refresh()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  // Row click handler (for future detail sheet)
  const handleRowClick = (row: UnifiedRow) => {
    setSelectedRow(row)
    setSheetOpen(true)
  }

  // Summary stats
  const completedPayments = payments.filter((p) => !p.voided_at)
  const totalReceived = completedPayments.reduce((sum, p) => sum + p.amount, 0)
  const unreconciledCount = unreconciledSquareTransactions.length

  return (
    <div className="space-y-6">
      {/* Square CTA Banner (no connection) */}
      {!hasSquareConnection && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                Connect Square to accept card payments
              </p>
              <p className="mt-1 text-sm text-amber-700">
                Link your Square account to automatically sync card transactions and enable online
                payments for scout families.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => router.push('/settings')}
              >
                Connect Square
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header + Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">All Payments</h2>
          <p className="text-sm text-stone-500">
            {filteredRows.length} payment{filteredRows.length !== 1 ? 's' : ''}
            {unreconciledCount > 0 && (
              <span className="ml-2 text-amber-600">
                ({unreconciledCount} unreconciled Square transaction
                {unreconciledCount !== 1 ? 's' : ''})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasSquareConnection && (
            <Button variant="outline" onClick={handleSync} disabled={isSyncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Square'}
            </Button>
          )}
          <QuickPaymentDialog unitId={unitId} scouts={scouts} />
        </div>
      </div>

      {/* Sync Error */}
      {syncError && (
        <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error">
          {syncError}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Received</CardDescription>
            <CardTitle className="text-2xl text-success">
              {formatCurrency(totalReceived)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">
              {completedPayments.length} completed payment
              {completedPayments.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unreconciled</CardDescription>
            <CardTitle className="text-2xl text-amber-600">{unreconciledCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">
              Square transaction{unreconciledCount !== 1 ? 's' : ''} pending reconciliation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Payments</CardDescription>
            <CardTitle className="text-2xl text-stone-900">{payments.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">All recorded payments</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Method filter */}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-stone-500">Method</span>
          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
            {(['all', 'cash', 'check', 'card', 'square'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMethodFilter(m)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors ${
                  methodFilter === m
                    ? 'bg-forest-700 text-white'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-stone-500">Status</span>
          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'completed', label: 'Completed' },
                { value: 'voided', label: 'Voided' },
                { value: 'needs_reconciliation', label: 'Unreconciled' },
              ] as const
            ).map((s) => (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  statusFilter === s.value
                    ? 'bg-forest-700 text-white'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range filter */}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-stone-500">Date range</span>
          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
            {(
              [
                { value: '7d', label: '7d' },
                { value: '30d', label: '30d' },
                { value: '90d', label: '90d' },
                { value: 'ytd', label: 'YTD' },
                { value: 'all', label: 'All' },
              ] as const
            ).map((d) => (
              <button
                key={d.value}
                onClick={() => setDateRange(d.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  dateRange === d.value
                    ? 'bg-forest-700 text-white'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-stone-500">Search</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="Scout name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white py-1.5 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-forest-500 focus:outline-none focus:ring-1 focus:ring-forest-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-sm font-medium text-stone-500">
                    <SortableHeader
                      label="Date"
                      field="date"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Scout"
                      field="scout"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Amount"
                      field="amount"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Method"
                      field="method"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Status"
                      field="status"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Recorded By"
                      field="recorded_by"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <th className="px-4 pb-3 pt-4" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.type}-${row.id}`}
                      onClick={() => handleRowClick(row)}
                      className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-stone-600">
                        {getRowDate(row) ? formatDate(getRowDate(row)) : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-stone-900">
                          {getRowScoutName(row) || (
                            <span className="text-stone-400">--</span>
                          )}
                        </span>
                        {row.type === 'unreconciled_square' && row.buyer_email_address && (
                          <p className="text-xs text-stone-500">{row.buyer_email_address}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-stone-900">
                        {formatCurrency(getRowAmount(row))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {getMethodIcon(getRowMethod(row))}
                          <span className="text-sm capitalize text-stone-700">
                            {getRowMethod(row)}
                          </span>
                          {row.type === 'unreconciled_square' &&
                            row.card_brand &&
                            row.last_4 && (
                              <span className="text-xs text-stone-400">
                                {row.card_brand} ····{row.last_4}
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(getRowStatus(row))}</td>
                      <td className="px-4 py-3 text-sm text-stone-600">
                        {getRowRecordedBy(row) || '--'}
                      </td>
                      <td className="px-4 py-3">
                        {row.type === 'payment' && row.square_receipt_url && (
                          <a
                            href={row.square_receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-stone-400 hover:text-stone-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        {row.type === 'unreconciled_square' && row.receipt_url && (
                          <a
                            href={row.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-stone-400 hover:text-stone-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-stone-500">
                {unifiedRows.length === 0
                  ? 'No payments recorded yet. Use "Record Payment" to get started.'
                  : 'No payments match the current filters.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Detail Sheet */}
      <PaymentDetailSheet
        row={selectedRow}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        scouts={scouts}
        unitId={unitId}
        userRole={userRole}
      />
    </div>
  )
}

// ── Sortable Header ────────────────────────────────────────────────────────

function SortableHeader({
  label,
  field,
  currentField,
  direction,
  onSort,
  className = '',
}: {
  label: string
  field: SortField
  currentField: SortField
  direction: SortDirection
  onSort: (field: SortField) => void
  className?: string
}) {
  const isActive = currentField === field
  return (
    <th className={`px-4 pb-3 pt-4 ${className}`}>
      <button
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-700"
      >
        {label}
        <ArrowUpDown
          className={`h-3 w-3 ${isActive ? 'text-stone-900' : 'text-stone-300'}`}
        />
        {isActive && (
          <span className="sr-only">{direction === 'asc' ? '(ascending)' : '(descending)'}</span>
        )}
      </button>
    </th>
  )
}
