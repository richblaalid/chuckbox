'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type ParsedBalanceCSV,
  type ColumnMapping,
  type MappedBalanceRow,
  autoDetectColumns,
  validateMapping,
  applyColumnMapping,
} from '@/lib/import/balance-csv-parser'

interface BalanceColumnMapperProps {
  csv: ParsedBalanceCSV
  onMappingChange: (mapping: ColumnMapping, isValid: boolean, previewRows: MappedBalanceRow[]) => void
}

const UNMAPPED_VALUE = '__unmapped__'

export function BalanceColumnMapper({ csv, onMappingChange }: BalanceColumnMapperProps) {
  // Initialize mapping with auto-detected columns
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoDetectColumns(csv.headers))
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Update parent whenever mapping changes
  const updateParent = useCallback((newMapping: ColumnMapping) => {
    const errors = validateMapping(newMapping)
    setValidationErrors(errors)
    const isValid = errors.length === 0
    const previewRows = isValid ? applyColumnMapping(csv, newMapping).slice(0, 5) : []
    onMappingChange(newMapping, isValid, previewRows)
  }, [csv, onMappingChange])

  // Run initial update
  useEffect(() => {
    updateParent(mapping)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle column selection changes
  const handleColumnChange = (field: keyof ColumnMapping, value: string) => {
    const newMapping = { ...mapping }

    if (value === UNMAPPED_VALUE) {
      delete newMapping[field]
    } else {
      const columnIndex = parseInt(value, 10)
      if (!isNaN(columnIndex)) {
        (newMapping[field] as number) = columnIndex
      }
    }

    // Clear single balance column if both billing and funds are set
    if (
      (field === 'billingBalanceColumn' || field === 'fundsBalanceColumn') &&
      value !== UNMAPPED_VALUE
    ) {
      delete newMapping.singleBalanceColumn
      delete newMapping.positiveBalanceMeaning
    }

    // Clear billing and funds columns if single balance is set
    if (field === 'singleBalanceColumn' && value !== UNMAPPED_VALUE) {
      delete newMapping.billingBalanceColumn
      delete newMapping.fundsBalanceColumn
    }

    setMapping(newMapping)
    updateParent(newMapping)
  }

  // Handle sign convention change
  const handleSignConventionChange = (value: 'credit' | 'owes') => {
    const newMapping = { ...mapping, positiveBalanceMeaning: value }
    setMapping(newMapping)
    updateParent(newMapping)
  }

  // Helper to get current value for select
  const getSelectValue = (field: keyof ColumnMapping): string => {
    const value = mapping[field]
    return value !== undefined ? String(value) : UNMAPPED_VALUE
  }

  // Generate preview rows
  const previewRows = validationErrors.length === 0
    ? applyColumnMapping(csv, mapping).slice(0, 5)
    : []

  // Format currency for display
  const formatCurrency = (value: number | undefined): string => {
    if (value === undefined) return '-'
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Math.abs(value))
    return value < 0 ? `-${formatted}` : formatted
  }

  return (
    <div className="space-y-6">
      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 mt-2">
              {validationErrors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Section 1: Scout Identification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scout Identification</CardTitle>
          <CardDescription>
            Map columns to identify scouts. BSA Member ID is the most reliable match when available.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bsaMemberId">BSA Member ID Column</Label>
            <Select
              value={getSelectValue('bsaMemberIdColumn')}
              onValueChange={(v) => handleColumnChange('bsaMemberIdColumn', v)}
            >
              <SelectTrigger id="bsaMemberId" className="max-w-sm">
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                {csv.headers.map((header, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {header}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-stone-500">Preferred — exact match, no ambiguity with duplicate names</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name Column</Label>
              <Select
                value={getSelectValue('firstNameColumn')}
                onValueChange={(v) => handleColumnChange('firstNameColumn', v)}
              >
                <SelectTrigger id="firstName">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                  {csv.headers.map((header, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name Column</Label>
              <Select
                value={getSelectValue('lastNameColumn')}
                onValueChange={(v) => handleColumnChange('lastNameColumn', v)}
              >
                <SelectTrigger id="lastName">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                  {csv.headers.map((header, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-stone-200" />
            <span className="text-sm text-stone-500">OR</span>
            <div className="h-px flex-1 bg-stone-200" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name Column</Label>
            <Select
              value={getSelectValue('fullNameColumn')}
              onValueChange={(v) => handleColumnChange('fullNameColumn', v)}
            >
              <SelectTrigger id="fullName" className="max-w-sm">
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                {csv.headers.map((header, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {header}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Balance Columns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance Columns</CardTitle>
          <CardDescription>
            Map columns for billing (amount owed) and funds (scout savings), or a single balance column.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="billingBalance">Billing Balance Column</Label>
              <Select
                value={getSelectValue('billingBalanceColumn')}
                onValueChange={(v) => handleColumnChange('billingBalanceColumn', v)}
              >
                <SelectTrigger id="billingBalance">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                  {csv.headers.map((header, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-stone-500">Amount the scout owes</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fundsBalance">Funds Balance Column</Label>
              <Select
                value={getSelectValue('fundsBalanceColumn')}
                onValueChange={(v) => handleColumnChange('fundsBalanceColumn', v)}
              >
                <SelectTrigger id="fundsBalance">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                  {csv.headers.map((header, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-stone-500">Scout savings/credit</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-stone-200" />
            <span className="text-sm text-stone-500">OR</span>
            <div className="h-px flex-1 bg-stone-200" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="singleBalance">Single Balance Column</Label>
            <Select
              value={getSelectValue('singleBalanceColumn')}
              onValueChange={(v) => handleColumnChange('singleBalanceColumn', v)}
            >
              <SelectTrigger id="singleBalance" className="max-w-sm">
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMAPPED_VALUE}>-- Not Mapped --</SelectItem>
                {csv.headers.map((header, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {header}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-stone-500">
              Use when you have a single balance column instead of separate billing/funds columns
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Sign Convention (only if single balance selected) */}
      {mapping.singleBalanceColumn !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign Convention</CardTitle>
            <CardDescription>
              How should positive and negative values be interpreted?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={mapping.positiveBalanceMeaning || ''}
              onValueChange={(v) => handleSignConventionChange(v as 'credit' | 'owes')}
              className="space-y-3"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="credit" id="credit" className="mt-0.5" />
                <Label htmlFor="credit" className="font-normal cursor-pointer">
                  <span className="font-medium">Scout has credit/savings</span>
                  <p className="text-sm text-stone-500">
                    Positive values = scout has funds. Negative values = scout owes money.
                  </p>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="owes" id="owes" className="mt-0.5" />
                <Label htmlFor="owes" className="font-normal cursor-pointer">
                  <span className="font-medium">Scout owes money</span>
                  <p className="text-sm text-stone-500">
                    Positive values = scout owes money. Negative values = scout has credit.
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {/* Section 4: Preview Table */}
      {previewRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              First {previewRows.length} rows with your column mapping applied
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-stone-500">
                    <th className="pb-2 pr-4">Row</th>
                    <th className="pb-2 pr-4">Name</th>
                    {mapping.bsaMemberIdColumn !== undefined && (
                      <th className="pb-2 pr-4">BSA ID</th>
                    )}
                    <th className="pb-2 pr-4 text-right">Billing Balance</th>
                    <th className="pb-2 pr-4 text-right">Funds Balance</th>
                    {previewRows.some(r => r.errors.length > 0) && (
                      <th className="pb-2 pr-4">Issues</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const displayName = row.fullName ||
                      (row.firstName || row.lastName
                        ? `${row.firstName || ''} ${row.lastName || ''}`.trim()
                        : '-')

                    return (
                      <tr key={row.lineNumber} className="border-b border-stone-100">
                        <td className="py-2 pr-4 text-stone-500">{row.lineNumber}</td>
                        <td className="py-2 pr-4 font-medium">{displayName}</td>
                        {mapping.bsaMemberIdColumn !== undefined && (
                          <td className="py-2 pr-4 text-stone-600">{row.bsaMemberId || '-'}</td>
                        )}
                        <td className={`py-2 pr-4 text-right ${
                          row.billingBalance !== undefined && row.billingBalance < 0
                            ? 'text-red-600'
                            : 'text-stone-600'
                        }`}>
                          {formatCurrency(row.billingBalance)}
                        </td>
                        <td className={`py-2 pr-4 text-right ${
                          row.fundsBalance !== undefined && row.fundsBalance > 0
                            ? 'text-green-600'
                            : 'text-stone-600'
                        }`}>
                          {formatCurrency(row.fundsBalance)}
                        </td>
                        {previewRows.some(r => r.errors.length > 0) && (
                          <td className="py-2 pr-4 text-red-600">
                            {row.errors.length > 0 ? row.errors.join(', ') : '-'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
