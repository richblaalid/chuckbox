'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type ParsedChargeCSV,
  type ChargeColumnMapping,
  type MappedChargeRow,
  autoDetectChargeColumns,
  validateChargeMapping,
  applyChargeColumnMapping,
} from '@/lib/import/charge-csv-parser'
import { formatCurrency } from '@/lib/utils'

interface ChargeColumnMapperProps {
  csv: ParsedChargeCSV
  onMappingChange: (mapping: ChargeColumnMapping, isValid: boolean, previewRows: MappedChargeRow[]) => void
}

const UNMAPPED_VALUE = '__unmapped__'

export function ChargeColumnMapper({ csv, onMappingChange }: ChargeColumnMapperProps) {
  const [mapping, setMapping] = useState<ChargeColumnMapping>(() => autoDetectChargeColumns(csv.headers))
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const updateParent = useCallback((newMapping: ChargeColumnMapping) => {
    const errors = validateChargeMapping(newMapping)
    setValidationErrors(errors)
    const isValid = errors.length === 0
    const previewRows = isValid ? applyChargeColumnMapping(csv, newMapping).slice(0, 5) : []
    onMappingChange(newMapping, isValid, previewRows)
  }, [csv, onMappingChange])

  useEffect(() => {
    updateParent(mapping)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleColumnChange = (field: keyof ChargeColumnMapping, value: string) => {
    const newMapping = { ...mapping }

    if (value === UNMAPPED_VALUE) {
      delete newMapping[field]
    } else {
      const columnIndex = parseInt(value, 10)
      if (!isNaN(columnIndex)) {
        (newMapping[field] as number) = columnIndex
      }
    }

    setMapping(newMapping)
    updateParent(newMapping)
  }

  const handleDefaultChange = (field: 'defaultDescription' | 'defaultDate', value: string) => {
    const newMapping = { ...mapping, [field]: value || undefined }
    if (!value) delete newMapping[field]
    setMapping(newMapping)
    updateParent(newMapping)
  }

  const getSelectValue = (field: keyof ChargeColumnMapping): string => {
    const value = mapping[field]
    return value !== undefined ? String(value) : UNMAPPED_VALUE
  }

  const previewRows = validationErrors.length === 0
    ? applyChargeColumnMapping(csv, mapping).slice(0, 5)
    : []

  const needsDefaultDescription = mapping.descriptionColumn === undefined
  const needsDefaultDate = mapping.dateColumn === undefined

  function ColumnSelect({ field, label, id }: { field: keyof ChargeColumnMapping; label: string; id: string }) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Select
          value={getSelectValue(field)}
          onValueChange={(v) => handleColumnChange(field, v)}
        >
          <SelectTrigger id={id}>
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
    )
  }

  return (
    <div className="space-y-6">
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

      {/* Scout Identification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scout Identification</CardTitle>
          <CardDescription>
            Map columns to identify scouts. BSA Member ID is the most reliable match when available.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ColumnSelect field="bsaMemberIdColumn" label="BSA Member ID Column" id="bsaMemberId" />
          <p className="-mt-2 text-xs text-stone-500">Preferred — exact match, no ambiguity with duplicate names</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColumnSelect field="firstNameColumn" label="First Name Column" id="firstName" />
            <ColumnSelect field="lastNameColumn" label="Last Name Column" id="lastName" />
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-stone-200" />
            <span className="text-sm text-stone-500">OR</span>
            <div className="h-px flex-1 bg-stone-200" />
          </div>

          <ColumnSelect field="fullNameColumn" label="Full Name Column" id="fullName" />
        </CardContent>
      </Card>

      {/* Charge Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Charge Details</CardTitle>
          <CardDescription>
            Map columns for the charge amount and optional details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColumnSelect field="amountColumn" label="Amount Column" id="amount" />
            <ColumnSelect field="descriptionColumn" label="Description Column" id="description" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColumnSelect field="dateColumn" label="Date Column" id="date" />
            <ColumnSelect field="referenceColumn" label="Reference / Invoice Column" id="reference" />
          </div>

          <ColumnSelect field="memoColumn" label="Memo / Notes Column" id="memo" />
        </CardContent>
      </Card>

      {/* Default Values (when columns not mapped) */}
      {(needsDefaultDescription || needsDefaultDate) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default Values</CardTitle>
            <CardDescription>
              These values will be applied to all rows since the CSV doesn&apos;t have dedicated columns.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {needsDefaultDescription && (
              <div className="space-y-2">
                <Label htmlFor="defaultDescription">Description (applied to all charges)</Label>
                <Input
                  id="defaultDescription"
                  placeholder="e.g., Summer Camp 2026"
                  value={mapping.defaultDescription || ''}
                  onChange={(e) => handleDefaultChange('defaultDescription', e.target.value)}
                />
              </div>
            )}
            {needsDefaultDate && (
              <div className="space-y-2">
                <Label htmlFor="defaultDate">Billing Date (applied to all charges)</Label>
                <Input
                  id="defaultDate"
                  type="date"
                  value={mapping.defaultDate || ''}
                  onChange={(e) => handleDefaultChange('defaultDate', e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preview Table */}
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
                    <th className="pb-2 pr-4 text-right">Amount</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4">Date</th>
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
                        <td className="py-2 pr-4 text-right font-medium text-stone-900">
                          {row.amount !== undefined ? formatCurrency(row.amount) : '-'}
                        </td>
                        <td className="py-2 pr-4 text-stone-600">{row.description || '-'}</td>
                        <td className="py-2 pr-4 text-stone-600">{row.date || '-'}</td>
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
