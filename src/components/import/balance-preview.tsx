'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Check, AlertCircle, HelpCircle, ArrowRight, Ban } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { type MappedBalanceRow } from '@/lib/import/balance-csv-parser'

// ============================================
// Types
// ============================================

interface Scout {
  id: string
  first_name: string
  last_name: string
  bsa_member_id: string | null
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance: number
  } | null
}

export interface PreviewRow extends MappedBalanceRow {
  matchStatus: 'matched' | 'unmatched' | 'error'
  matchedScout?: Scout
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string
}

interface BalancePreviewProps {
  rows: MappedBalanceRow[]
  scouts: Scout[]
  mode: 'set' | 'adjust'
  onRowsChange: (rows: PreviewRow[]) => void
}

// ============================================
// Matching Utilities
// ============================================

function normalizeString(str: string): string {
  return str.toLowerCase().trim()
}

function matchScoutToRow(row: MappedBalanceRow, scouts: Scout[]): Scout | undefined {
  // First try BSA ID match (exact)
  if (row.bsaMemberId) {
    const bsaMatch = scouts.find(
      (s) => s.bsa_member_id && s.bsa_member_id === row.bsaMemberId
    )
    if (bsaMatch) return bsaMatch
  }

  // Then try name match (case-insensitive)
  const rowFirstName = normalizeString(row.firstName || '')
  const rowLastName = normalizeString(row.lastName || '')

  if (rowFirstName || rowLastName) {
    const nameMatch = scouts.find((s) => {
      const scoutFirstName = normalizeString(s.first_name)
      const scoutLastName = normalizeString(s.last_name)

      // Both names must match if both are provided
      if (rowFirstName && rowLastName) {
        return scoutFirstName === rowFirstName && scoutLastName === rowLastName
      }

      // Otherwise match on whichever is provided
      if (rowFirstName && scoutFirstName === rowFirstName) return true
      if (rowLastName && scoutLastName === rowLastName) return true

      return false
    })
    if (nameMatch) return nameMatch
  }

  return undefined
}

function initializePreviewRows(rows: MappedBalanceRow[], scouts: Scout[]): PreviewRow[] {
  return rows.map((row) => {
    // Check for errors first
    if (row.errors.length > 0) {
      return {
        ...row,
        matchStatus: 'error' as const,
        action: 'skip' as const,
      }
    }

    // Try to match scout
    const matchedScout = matchScoutToRow(row, scouts)

    if (matchedScout) {
      return {
        ...row,
        matchStatus: 'matched' as const,
        matchedScout,
        action: 'import' as const,
      }
    }

    return {
      ...row,
      matchStatus: 'unmatched' as const,
      action: 'skip' as const,
    }
  })
}

// ============================================
// Component
// ============================================

export function BalancePreview({ rows, scouts, mode, onRowsChange }: BalancePreviewProps) {
  // Initialize preview rows with matching
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>(() =>
    initializePreviewRows(rows, scouts)
  )

  // Update parent when rows change
  useEffect(() => {
    onRowsChange(previewRows)
  }, [previewRows, onRowsChange])

  // Calculate summary stats
  const stats = useMemo(() => {
    const matched = previewRows.filter((r) => r.matchStatus === 'matched').length
    const unmatched = previewRows.filter((r) => r.matchStatus === 'unmatched').length
    const errors = previewRows.filter((r) => r.matchStatus === 'error').length
    const willImport = previewRows.filter((r) => r.action === 'import' || r.action === 'manual_match').length

    return { matched, unmatched, errors, willImport }
  }, [previewRows])

  // Get available scouts for manual matching (not already matched)
  const availableScoutsForManualMatch = useMemo(() => {
    const matchedScoutIds = new Set(
      previewRows
        .filter((r) => r.matchStatus === 'matched' || r.action === 'manual_match')
        .map((r) => r.matchedScout?.id || r.manualMatchScoutId)
        .filter(Boolean)
    )
    return scouts.filter((s) => !matchedScoutIds.has(s.id))
  }, [previewRows, scouts])

  // Handle action change for a row
  const handleActionChange = (rowIndex: number, newAction: 'import' | 'skip' | 'manual_match') => {
    setPreviewRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIndex) return row

        if (newAction === 'skip') {
          return {
            ...row,
            action: 'skip' as const,
            manualMatchScoutId: undefined,
            matchedScout: row.matchStatus === 'matched' ? row.matchedScout : undefined,
          }
        }

        if (newAction === 'import' && row.matchStatus === 'matched') {
          return { ...row, action: 'import' as const }
        }

        return row
      })
    )
  }

  // Handle manual scout selection
  const handleManualScoutSelect = (rowIndex: number, scoutId: string) => {
    const selectedScout = scouts.find((s) => s.id === scoutId)
    if (!selectedScout) return

    setPreviewRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIndex) return row

        return {
          ...row,
          action: 'manual_match' as const,
          manualMatchScoutId: scoutId,
          matchedScout: selectedScout,
        }
      })
    )
  }

  // Calculate new balance for display
  const calculateNewBalance = (
    currentBalance: number | null | undefined,
    csvBalance: number | undefined,
    isAdjust: boolean
  ): number | null => {
    if (csvBalance === undefined) return currentBalance ?? null

    if (isAdjust) {
      return (currentBalance ?? 0) + csvBalance
    }

    return csvBalance
  }

  // Format display name from CSV row
  const getDisplayName = (row: MappedBalanceRow): string => {
    if (row.fullName) return row.fullName
    if (row.firstName || row.lastName) {
      return `${row.firstName || ''} ${row.lastName || ''}`.trim()
    }
    return '-'
  }

  // Get status icon
  const StatusIcon = ({ status }: { status: 'matched' | 'unmatched' | 'error' }) => {
    switch (status) {
      case 'matched':
        return <Check className="h-4 w-4 text-green-600" />
      case 'unmatched':
        return <HelpCircle className="h-4 w-4 text-amber-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <Card className="hover:shadow-sm hover:translate-y-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-center">
            <Badge variant="success" className="gap-1">
              <Check className="h-3 w-3" />
              {stats.matched} matched
            </Badge>
            <Badge variant="warning" className="gap-1">
              <HelpCircle className="h-3 w-3" />
              {stats.unmatched} unmatched
            </Badge>
            {stats.errors > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                {stats.errors} errors
              </Badge>
            )}
            <span className="text-stone-400 mx-1">|</span>
            <span className="text-sm text-stone-600">
              <strong>{stats.willImport}</strong> will be imported
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Preview Table */}
      <Card className="hover:shadow-sm hover:translate-y-0">
        <CardHeader>
          <CardTitle className="text-base">Row Details</CardTitle>
          <CardDescription>
            Review matches and resolve unmatched rows
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-stone-500">
                  <th className="pb-2 pr-4 w-10">Status</th>
                  <th className="pb-2 pr-4">CSV Name</th>
                  <th className="pb-2 pr-4">Matched Scout</th>
                  <th className="pb-2 pr-4 text-right">Billing Balance</th>
                  <th className="pb-2 pr-4 text-right">Funds Balance</th>
                  <th className="pb-2 pr-4 w-32">Action</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => {
                  const currentScout =
                    row.matchedScout || scouts.find((s) => s.id === row.manualMatchScoutId)

                  const currentBilling = currentScout?.scout_accounts?.billing_balance ?? 0
                  const currentFunds = currentScout?.scout_accounts?.funds_balance ?? 0

                  const newBilling = calculateNewBalance(
                    currentBilling,
                    row.billingBalance,
                    mode === 'adjust'
                  )
                  const newFunds = calculateNewBalance(
                    currentFunds,
                    row.fundsBalance,
                    mode === 'adjust'
                  )

                  const shouldShowBalanceChange =
                    row.action === 'import' || row.action === 'manual_match'

                  return (
                    <tr
                      key={row.lineNumber}
                      className={`border-b border-stone-100 ${
                        row.action === 'skip' ? 'opacity-50' : ''
                      }`}
                    >
                      {/* Status */}
                      <td className="py-2 pr-4">
                        <StatusIcon status={row.matchStatus} />
                      </td>

                      {/* CSV Name */}
                      <td className="py-2 pr-4 font-medium">{getDisplayName(row)}</td>

                      {/* Matched Scout */}
                      <td className="py-2 pr-4">
                        {row.matchStatus === 'matched' && row.matchedScout && (
                          <span className="text-stone-900">
                            {row.matchedScout.first_name} {row.matchedScout.last_name}
                          </span>
                        )}
                        {row.matchStatus === 'unmatched' && (
                          <Select
                            value={row.manualMatchScoutId || ''}
                            onValueChange={(v) => handleManualScoutSelect(index, v)}
                          >
                            <SelectTrigger className="h-8 w-48">
                              <SelectValue placeholder="Select scout..." />
                            </SelectTrigger>
                            <SelectContent>
                              {availableScoutsForManualMatch.map((scout) => (
                                <SelectItem key={scout.id} value={scout.id}>
                                  {scout.first_name} {scout.last_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {row.matchStatus === 'error' && (
                          <span className="text-red-500 text-xs">
                            {row.errors.join(', ')}
                          </span>
                        )}
                      </td>

                      {/* Billing Balance */}
                      <td className="py-2 pr-4 text-right">
                        {shouldShowBalanceChange && row.billingBalance !== undefined ? (
                          <span className="flex items-center justify-end gap-1">
                            <span className="text-stone-500">
                              {formatCurrency(currentBilling)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-stone-400" />
                            <span
                              className={
                                newBilling !== null && newBilling < 0
                                  ? 'text-red-600 font-medium'
                                  : 'text-stone-900 font-medium'
                              }
                            >
                              {newBilling !== null ? formatCurrency(newBilling) : '-'}
                            </span>
                          </span>
                        ) : row.billingBalance !== undefined ? (
                          <span className="text-stone-400">
                            {formatCurrency(row.billingBalance)}
                          </span>
                        ) : (
                          <span className="text-stone-300">-</span>
                        )}
                      </td>

                      {/* Funds Balance */}
                      <td className="py-2 pr-4 text-right">
                        {shouldShowBalanceChange && row.fundsBalance !== undefined ? (
                          <span className="flex items-center justify-end gap-1">
                            <span className="text-stone-500">
                              {formatCurrency(currentFunds)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-stone-400" />
                            <span
                              className={
                                newFunds !== null && newFunds > 0
                                  ? 'text-green-600 font-medium'
                                  : 'text-stone-900 font-medium'
                              }
                            >
                              {newFunds !== null ? formatCurrency(newFunds) : '-'}
                            </span>
                          </span>
                        ) : row.fundsBalance !== undefined ? (
                          <span className="text-stone-400">
                            {formatCurrency(row.fundsBalance)}
                          </span>
                        ) : (
                          <span className="text-stone-300">-</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-2 pr-4">
                        {row.matchStatus === 'error' ? (
                          <Badge variant="secondary" className="gap-1">
                            <Ban className="h-3 w-3" />
                            Skip
                          </Badge>
                        ) : row.matchStatus === 'matched' ? (
                          <Select
                            value={row.action}
                            onValueChange={(v) =>
                              handleActionChange(index, v as 'import' | 'skip')
                            }
                          >
                            <SelectTrigger className="h-8 w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="import">Import</SelectItem>
                              <SelectItem value="skip">Skip</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : row.action === 'manual_match' ? (
                          <Select
                            value={row.action}
                            onValueChange={(v) =>
                              handleActionChange(index, v as 'import' | 'skip')
                            }
                          >
                            <SelectTrigger className="h-8 w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual_match">Import</SelectItem>
                              <SelectItem value="skip">Skip</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Ban className="h-3 w-3" />
                            Skip
                          </Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
