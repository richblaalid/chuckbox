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
import { Check, AlertCircle, HelpCircle, Ban } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { type MappedChargeRow } from '@/lib/import/charge-csv-parser'

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

export interface ChargePreviewRow extends MappedChargeRow {
  matchStatus: 'matched' | 'unmatched' | 'error'
  matchedScout?: Scout
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string
}

interface ChargePreviewProps {
  rows: MappedChargeRow[]
  scouts: Scout[]
  onRowsChange: (rows: ChargePreviewRow[]) => void
}

// ============================================
// Matching Utilities
// ============================================

function normalizeString(str: string): string {
  return str.toLowerCase().trim()
}

function matchScoutToRow(row: MappedChargeRow, scouts: Scout[]): Scout | undefined {
  if (row.bsaMemberId) {
    const bsaMatch = scouts.find(
      (s) => s.bsa_member_id && s.bsa_member_id === row.bsaMemberId
    )
    if (bsaMatch) return bsaMatch
  }

  const rowFirstName = normalizeString(row.firstName || '')
  const rowLastName = normalizeString(row.lastName || '')

  if (rowFirstName || rowLastName) {
    const nameMatch = scouts.find((s) => {
      const scoutFirstName = normalizeString(s.first_name)
      const scoutLastName = normalizeString(s.last_name)

      if (rowFirstName && rowLastName) {
        return scoutFirstName === rowFirstName && scoutLastName === rowLastName
      }

      if (rowFirstName && scoutFirstName === rowFirstName) return true
      if (rowLastName && scoutLastName === rowLastName) return true

      return false
    })
    if (nameMatch) return nameMatch
  }

  return undefined
}

function initializePreviewRows(rows: MappedChargeRow[], scouts: Scout[]): ChargePreviewRow[] {
  return rows.map((row) => {
    if (row.errors.length > 0) {
      return {
        ...row,
        matchStatus: 'error' as const,
        action: 'skip' as const,
      }
    }

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

export function ChargePreview({ rows, scouts, onRowsChange }: ChargePreviewProps) {
  const [previewRows, setPreviewRows] = useState<ChargePreviewRow[]>(() =>
    initializePreviewRows(rows, scouts)
  )

  useEffect(() => {
    onRowsChange(previewRows)
  }, [previewRows, onRowsChange])

  const summary = useMemo(() => {
    const matched = previewRows.filter((r) => r.matchStatus === 'matched')
    const unmatched = previewRows.filter((r) => r.matchStatus === 'unmatched')
    const errors = previewRows.filter((r) => r.matchStatus === 'error')
    const willImport = previewRows.filter((r) => r.action === 'import' || r.action === 'manual_match')
    const totalAmount = willImport.reduce((sum, r) => sum + (r.amount || 0), 0)

    return { matched, unmatched, errors, willImport, totalAmount }
  }, [previewRows])

  const handleManualMatch = (rowIndex: number, scoutId: string) => {
    const updatedRows = [...previewRows]
    const scout = scouts.find((s) => s.id === scoutId)

    if (scout) {
      updatedRows[rowIndex] = {
        ...updatedRows[rowIndex],
        matchStatus: 'matched',
        matchedScout: scout,
        action: 'manual_match',
        manualMatchScoutId: scoutId,
      }
    }

    setPreviewRows(updatedRows)
  }

  const handleSkip = (rowIndex: number) => {
    const updatedRows = [...previewRows]
    updatedRows[rowIndex] = {
      ...updatedRows[rowIndex],
      action: 'skip',
      matchedScout: undefined,
      manualMatchScoutId: undefined,
      matchStatus: updatedRows[rowIndex].errors.length > 0 ? 'error' : 'unmatched',
    }
    setPreviewRows(updatedRows)
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-stone-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{summary.matched.length}</p>
          <p className="text-sm text-stone-500">Matched</p>
        </div>
        <div className="rounded-lg border border-stone-200 p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{summary.unmatched.length}</p>
          <p className="text-sm text-stone-500">Unmatched</p>
        </div>
        <div className="rounded-lg border border-stone-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{summary.errors.length}</p>
          <p className="text-sm text-stone-500">Errors</p>
        </div>
        <div className="rounded-lg border border-stone-200 p-4 text-center">
          <p className="text-2xl font-bold text-forest-700">{formatCurrency(summary.totalAmount)}</p>
          <p className="text-sm text-stone-500">Total to Import</p>
        </div>
      </div>

      {/* Row Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Charge Preview</CardTitle>
          <CardDescription>
            {summary.willImport.length} of {previewRows.length} charges will be imported
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-stone-500">
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">CSV Name</th>
                  <th className="pb-2 pr-4">Matched Scout</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 pr-4">Description</th>
                  <th className="pb-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => {
                  const displayName = row.fullName ||
                    `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'

                  return (
                    <tr key={row.lineNumber} className="border-b border-stone-100">
                      <td className="py-2 pr-4">
                        {row.matchStatus === 'matched' && (
                          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                            <Check className="mr-1 h-3 w-3" />
                            Matched
                          </Badge>
                        )}
                        {row.matchStatus === 'unmatched' && (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            <HelpCircle className="mr-1 h-3 w-3" />
                            Unmatched
                          </Badge>
                        )}
                        {row.matchStatus === 'error' && (
                          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                            <AlertCircle className="mr-1 h-3 w-3" />
                            Error
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-medium text-stone-900">{displayName}</td>
                      <td className="py-2 pr-4">
                        {row.matchedScout ? (
                          <span className="text-stone-700">
                            {row.matchedScout.first_name} {row.matchedScout.last_name}
                          </span>
                        ) : row.matchStatus === 'error' ? (
                          <span className="text-red-600 text-xs">{row.errors.join(', ')}</span>
                        ) : (
                          <Select
                            onValueChange={(v) => {
                              if (v === '__skip__') {
                                handleSkip(index)
                              } else {
                                handleManualMatch(index, v)
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select scout..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__skip__">
                                <span className="flex items-center gap-1">
                                  <Ban className="h-3 w-3" /> Skip this row
                                </span>
                              </SelectItem>
                              {scouts.map((scout) => (
                                <SelectItem key={scout.id} value={scout.id}>
                                  {scout.first_name} {scout.last_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium text-stone-900">
                        {row.amount !== undefined ? formatCurrency(row.amount) : '-'}
                      </td>
                      <td className="py-2 pr-4 text-stone-600 max-w-[200px] truncate">
                        {row.description || '-'}
                      </td>
                      <td className="py-2 pr-4">
                        {row.action === 'import' || row.action === 'manual_match' ? (
                          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                            Import
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-stone-200 text-stone-500">
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
