'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ChargeUpload } from './charge-upload'
import { ChargeColumnMapper } from './charge-column-mapper'
import { ChargePreview, type ChargePreviewRow } from './charge-preview'
import { ChargeImportComplete } from './charge-import-complete'
import {
  type ParsedChargeCSV,
  type ChargeColumnMapping,
  type MappedChargeRow,
  applyChargeColumnMapping,
} from '@/lib/import/charge-csv-parser'
import { Loader2, CheckCircle, ArrowLeft, ArrowRight, Upload } from 'lucide-react'

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

interface ChargeImportWizardProps {
  scouts: Scout[]
  unitId: string
}

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'complete'

interface ImportResultRow {
  scoutName: string
  amount: number
  error?: string
}

interface ImportResult {
  imported: number
  skipped: number
  totalAmount: number
  batchId: string
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

export function ChargeImportWizard({ scouts, unitId }: ChargeImportWizardProps) {
  const router = useRouter()

  // Wizard state
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)

  // Upload step state
  const [csv, setCsv] = useState<ParsedChargeCSV | null>(null)
  const [fileName, setFileName] = useState<string>('')

  // Map step state
  const [mapping, setMapping] = useState<ChargeColumnMapping | null>(null)
  const [mappingValid, setMappingValid] = useState(false)

  // Preview step state
  const [previewRows, setPreviewRows] = useState<ChargePreviewRow[]>([])

  // Result state
  const [result, setResult] = useState<ImportResult | null>(null)

  // ============================================
  // Upload Step Handlers
  // ============================================

  const handleParsed = useCallback((parsedCsv: ParsedChargeCSV, name: string) => {
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
    (newMapping: ChargeColumnMapping, isValid: boolean, _previewRows: MappedChargeRow[]) => {
      setMapping(newMapping)
      setMappingValid(isValid)
    },
    []
  )

  const handleContinueToPreview = useCallback(() => {
    if (!csv || !mapping) return
    setPreviewRows([])
    setStep('preview')
  }, [csv, mapping])

  // ============================================
  // Preview Step Handlers
  // ============================================

  const handlePreviewRowsChange = useCallback((rows: ChargePreviewRow[]) => {
    setPreviewRows(rows)
  }, [])

  const handleImport = useCallback(async () => {
    if (!mapping || previewRows.length === 0) return

    setStep('importing')
    setError(null)

    try {
      const rowsToImport = previewRows.filter(
        (row) => row.action === 'import' || row.action === 'manual_match'
      )

      if (rowsToImport.length === 0) {
        setResult({ imported: 0, skipped: previewRows.length, totalAmount: 0, batchId: '', errors: [] })
        setStep('complete')
        return
      }

      const payload = {
        unitId,
        fileName,
        rows: rowsToImport.map((row) => ({
          scoutId: row.matchedScout?.id,
          scoutAccountId: row.matchedScout?.scout_accounts?.id,
          amount: row.amount,
          description: row.description,
          date: row.date,
          reference: row.reference,
          memo: row.memo,
          action: row.action,
          manualMatchScoutId: row.manualMatchScoutId,
        })),
      }

      const response = await fetch('/api/import/charges', {
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
        totalAmount: data.totalAmount || rowsToImport.reduce((sum, r) => sum + (r.amount || 0), 0),
        batchId: data.batchId || '',
        errors: data.errors || [],
      })
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }, [unitId, fileName, mapping, previewRows])

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
    router.push('/finances')
    router.refresh()
  }, [router])

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

  const getMappedRows = useCallback((): MappedChargeRow[] => {
    if (!csv || !mapping) return []
    return applyChargeColumnMapping(csv, mapping)
  }, [csv, mapping])

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-6">
      <ProgressIndicator currentStep={step} />

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
              Upload Billing Charges CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV file with scout names and charge amounts. Each row will create a billing charge.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChargeUpload onParsed={handleParsed} onError={handleUploadError} />
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

          <ChargeColumnMapper csv={csv} onMappingChange={handleMappingChange} />

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
            <span>{csv.rows.length} charges</span>
          </div>

          <ChargePreview
            rows={getMappedRows()}
            scouts={scouts}
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
              Import Charges
            </Button>
          </div>
        </>
      )}

      {/* Step 4: Importing */}
      {step === 'importing' && (
        <Card className="hover:shadow-sm hover:translate-y-0">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-forest-600" />
            <p className="mt-4 text-lg font-medium text-stone-900">Creating billing charges...</p>
            <p className="text-sm text-stone-500">Please wait while we create charges and update accounts</p>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Complete */}
      {step === 'complete' && result && (
        <ChargeImportComplete
          result={result}
          onStartOver={handleStartOver}
          onDone={handleDone}
        />
      )}
    </div>
  )
}
