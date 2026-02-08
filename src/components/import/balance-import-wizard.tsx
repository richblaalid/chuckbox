'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BalanceUpload } from './balance-upload'
import { BalanceColumnMapper } from './balance-column-mapper'
import { BalancePreview, type PreviewRow } from './balance-preview'
import {
  type ParsedBalanceCSV,
  type ColumnMapping,
  type MappedBalanceRow,
  applyColumnMapping,
} from '@/lib/import/balance-csv-parser'
import { Loader2, CheckCircle, AlertCircle, ArrowLeft, ArrowRight, Upload } from 'lucide-react'

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

interface BalanceImportWizardProps {
  scouts: Scout[]
  onComplete?: () => void
}

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'complete'

type ImportMode = 'set' | 'adjust'

interface ImportResultRow {
  scoutId: string
  scoutName: string
  billingBalance?: number
  fundsBalance?: number
  error?: string
}

interface ImportResult {
  imported: number
  skipped: number
  errors: ImportResultRow[]
}

// ============================================
// Progress Indicator
// ============================================

const STEPS = [
  { key: 'upload', label: '1. Upload' },
  { key: 'map', label: '2. Map Columns' },
  { key: 'preview', label: '3. Preview' },
  { key: 'complete', label: '4. Complete' },
] as const

function ProgressIndicator({ currentStep }: { currentStep: Step }) {
  const stepIndex = (() => {
    switch (currentStep) {
      case 'upload':
        return 0
      case 'map':
        return 1
      case 'preview':
      case 'importing':
        return 2
      case 'complete':
        return 3
    }
  })()

  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, index) => (
        <div key={step.key} className="flex items-center">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              index === stepIndex
                ? 'bg-forest-600 text-white'
                : index < stepIndex
                  ? 'bg-forest-100 text-forest-700'
                  : 'bg-stone-100 text-stone-500'
            }`}
          >
            {index < stepIndex && <CheckCircle className="h-4 w-4" />}
            <span>{step.label}</span>
          </div>
          {index < STEPS.length - 1 && (
            <ArrowRight className="mx-2 h-4 w-4 text-stone-300" />
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export function BalanceImportWizard({ scouts, onComplete }: BalanceImportWizardProps) {
  const router = useRouter()

  // Wizard state
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)

  // Upload step state
  const [csv, setCsv] = useState<ParsedBalanceCSV | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [mode, setMode] = useState<ImportMode>('set')

  // Map step state
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [mappingValid, setMappingValid] = useState(false)

  // Preview step state
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])

  // Result state
  const [result, setResult] = useState<ImportResult | null>(null)

  // ============================================
  // Upload Step Handlers
  // ============================================

  const handleParsed = useCallback((parsedCsv: ParsedBalanceCSV, name: string) => {
    setCsv(parsedCsv)
    setFileName(name)
    setError(null)
    setStep('map')
  }, [])

  const handleUploadError = useCallback((errorMessage: string) => {
    setError(errorMessage)
  }, [])

  // ============================================
  // Map Step Handlers
  // ============================================

  const handleMappingChange = useCallback(
    (newMapping: ColumnMapping, isValid: boolean, _previewRows: MappedBalanceRow[]) => {
      setMapping(newMapping)
      setMappingValid(isValid)
    },
    []
  )

  const handleContinueToPreview = useCallback(() => {
    if (!csv || !mapping) return

    // Apply mapping to all rows
    const allMappedRows = applyColumnMapping(csv, mapping)

    // Convert to preview rows (the preview component will handle matching)
    setPreviewRows([]) // Reset - will be populated by preview component
    setStep('preview')
  }, [csv, mapping])

  // ============================================
  // Preview Step Handlers
  // ============================================

  const handlePreviewRowsChange = useCallback((rows: PreviewRow[]) => {
    setPreviewRows(rows)
  }, [])

  const handleImport = useCallback(async () => {
    if (!mapping || previewRows.length === 0) return

    setStep('importing')
    setError(null)

    try {
      // Filter to rows that will be imported
      const rowsToImport = previewRows.filter(
        (row) => row.action === 'import' || row.action === 'manual_match'
      )

      if (rowsToImport.length === 0) {
        setResult({ imported: 0, skipped: previewRows.length, errors: [] })
        setStep('complete')
        return
      }

      // Prepare payload
      const payload = {
        mode,
        rows: rowsToImport.map((row) => ({
          scoutId: row.matchedScout?.id,
          scoutAccountId: row.matchedScout?.scout_accounts?.id,
          billingBalance: row.billingBalance,
          fundsBalance: row.fundsBalance,
          action: row.action,
          manualMatchScoutId: row.manualMatchScoutId,
        })),
      }

      // Make API call
      const response = await fetch('/api/import/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Import failed')
      }

      const data = await response.json()

      setResult({
        imported: data.imported || rowsToImport.length,
        skipped: previewRows.length - rowsToImport.length,
        errors: data.errors || [],
      })
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }, [mode, mapping, previewRows])

  // ============================================
  // Navigation Handlers
  // ============================================

  const handleBack = useCallback(() => {
    if (step === 'map') {
      setStep('upload')
      setCsv(null)
      setFileName('')
      setMapping(null)
    } else if (step === 'preview') {
      setStep('map')
    }
    setError(null)
  }, [step])

  const handleDone = useCallback(() => {
    router.push('/finances/accounts')
    router.refresh()
    onComplete?.()
  }, [router, onComplete])

  const handleStartOver = useCallback(() => {
    setStep('upload')
    setCsv(null)
    setFileName('')
    setMapping(null)
    setMappingValid(false)
    setPreviewRows([])
    setResult(null)
    setError(null)
  }, [])

  // ============================================
  // Get mapped rows for preview
  // ============================================

  const getMappedRows = useCallback((): MappedBalanceRow[] => {
    if (!csv || !mapping) return []
    return applyColumnMapping(csv, mapping)
  }, [csv, mapping])

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-6">
      {/* Progress Indicator */}
      <ProgressIndicator currentStep={step} />

      {/* Error Display */}
      {error && (
        <Alert variant="error">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card className="hover:shadow-sm hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Balance CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV file containing scout account balances
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Import Mode Selection */}
            <div className="space-y-3">
              <Label>Import Mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as ImportMode)}
                className="space-y-3"
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="set" id="mode-set" className="mt-0.5" />
                  <Label htmlFor="mode-set" className="font-normal cursor-pointer">
                    <span className="font-medium">Set balances</span>
                    <p className="text-sm text-stone-500">
                      Replace current balances with values from the CSV
                    </p>
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="adjust" id="mode-adjust" className="mt-0.5" />
                  <Label htmlFor="mode-adjust" className="font-normal cursor-pointer">
                    <span className="font-medium">Adjust balances</span>
                    <p className="text-sm text-stone-500">
                      Add or subtract CSV values from current balances
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Upload Area */}
            <BalanceUpload onParsed={handleParsed} onError={handleUploadError} />
          </CardContent>
        </Card>
      )}

      {/* Step 2: Map Columns */}
      {step === 'map' && csv && (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <span className="font-medium">File:</span> {fileName}
            <span className="text-stone-400">|</span>
            <span>{csv.rows.length} rows</span>
          </div>

          <BalanceColumnMapper csv={csv} onMappingChange={handleMappingChange} />

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleContinueToPreview} disabled={!mappingValid}>
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && csv && mapping && (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <span className="font-medium">File:</span> {fileName}
            <span className="text-stone-400">|</span>
            <span className="font-medium">Mode:</span>{' '}
            {mode === 'set' ? 'Set balances' : 'Adjust balances'}
          </div>

          <BalancePreview
            rows={getMappedRows()}
            scouts={scouts}
            mode={mode}
            onRowsChange={handlePreviewRowsChange}
          />

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleImport}
              disabled={previewRows.filter((r) => r.action === 'import' || r.action === 'manual_match').length === 0}
            >
              Import Balances
            </Button>
          </div>
        </>
      )}

      {/* Step 4: Importing */}
      {step === 'importing' && (
        <Card className="hover:shadow-sm hover:translate-y-0">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-forest-600" />
            <p className="mt-4 text-lg font-medium text-stone-900">Importing balances...</p>
            <p className="text-sm text-stone-500">Please wait while we update scout accounts</p>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Complete */}
      {step === 'complete' && result && (
        <>
          <Card className="hover:shadow-sm hover:translate-y-0">
            <CardHeader>
              <CardTitle
                className={`flex items-center gap-2 ${
                  result.errors.length > 0 ? 'text-warning' : 'text-green-600'
                }`}
              >
                {result.errors.length > 0 ? (
                  <AlertCircle className="h-6 w-6" />
                ) : (
                  <CheckCircle className="h-6 w-6" />
                )}
                {result.errors.length > 0 ? 'Import Completed with Errors' : 'Import Complete'}
              </CardTitle>
              <CardDescription>
                {result.errors.length > 0
                  ? 'Some balances could not be imported'
                  : 'Scout account balances have been updated successfully'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary Stats */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-stone-200 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                  <p className="text-sm text-stone-500">Imported</p>
                </div>
                <div className="rounded-lg border border-stone-200 p-4 text-center">
                  <p className="text-2xl font-bold text-stone-600">{result.skipped}</p>
                  <p className="text-sm text-stone-500">Skipped</p>
                </div>
                <div className="rounded-lg border border-stone-200 p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
                  <p className="text-sm text-stone-500">Errors</p>
                </div>
              </div>

              {/* Error List */}
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
                  <ul className="space-y-1 text-sm text-red-700">
                    {result.errors.map((err, i) => (
                      <li key={i}>
                        <span className="font-medium">{err.scoutName}:</span> {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-center gap-4">
            <Button variant="outline" onClick={handleStartOver}>
              Import Another File
            </Button>
            <Button onClick={handleDone}>Done</Button>
          </div>
        </>
      )}
    </div>
  )
}
