'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TrailMarker } from '@/components/ui/trail-marker'
import { FadeIn } from '@/components/ui/page-transition'
import { type ParsedRoster, type UnitMetadata } from '@/lib/import/bsa-roster-parser'
import { extractUnitFromCSV, provisionUnitAuthenticated } from '@/app/actions/onboarding'
import { RosterPreview } from './roster-preview'

const STEPS_CSV = [
  { id: 'upload', label: 'Upload Roster' },
  { id: 'confirm', label: 'Confirm Unit' },
]

const STEPS_MANUAL = [
  { id: 'upload', label: 'Get Started' },
  { id: 'unit', label: 'Unit Details' },
]

export function CreateUnitWizard() {
  const [currentStep, setCurrentStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    existingUnitName: string
    existingUnitType?: string
    existingUnitNumber?: string
    existingCouncil?: string
  } | null>(null)

  const [signupPath, setSignupPath] = useState<'csv' | 'manual'>('csv')

  // Step 1: File upload state
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)

  // Step 2: Unit confirmation state
  const [unitMetadata, setUnitMetadata] = useState<UnitMetadata | null>(null)
  const [rosterSummary, setRosterSummary] = useState<{ adultCount: number; scoutCount: number; patrolCount: number } | null>(null)
  const [parsedRoster, setParsedRoster] = useState<ParsedRoster | null>(null)

  // Manual unit entry form state
  const [manualUnitInfo, setManualUnitInfo] = useState({
    unitType: 'troop' as 'troop' | 'pack' | 'crew' | 'ship',
    unitNumber: '',
    unitSuffix: '',
    council: '',
    district: '',
  })

  const [validationErrors, setValidationErrors] = useState<{ unitNumber?: string }>({})

  // ============================================
  // Step 1: File Upload
  // ============================================

  const processFile = useCallback(async (uploadedFile: File) => {
    if (!uploadedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }

    setFile(uploadedFile)
    setIsParsing(true)
    setError(null)

    try {
      const content = await uploadedFile.text()
      const result = await extractUnitFromCSV(content)

      if (!result.success || !result.unitMetadata || !result.roster) {
        setError(result.error || 'Could not parse the CSV file')
        setFile(null)
        setIsParsing(false)
        return
      }

      setUnitMetadata(result.unitMetadata)
      setRosterSummary(result.rosterSummary || null)
      setParsedRoster(result.roster)

      setManualUnitInfo({
        unitType: result.unitMetadata.unitType || 'troop',
        unitNumber: result.unitMetadata.unitNumber || '',
        unitSuffix: result.unitMetadata.unitSuffix || '',
        council: result.unitMetadata.council || '',
        district: result.unitMetadata.district || '',
      })
      setIsParsing(false)
      setCurrentStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
      setFile(null)
      setIsParsing(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) processFile(droppedFile)
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) processFile(selectedFile)
  }, [processFile])

  const clearFile = useCallback(() => {
    setFile(null)
    setUnitMetadata(null)
    setRosterSummary(null)
    setParsedRoster(null)
    setCurrentStep(0)
    setSignupPath('csv')
    setError(null)
  }, [])

  const handleSkipForNow = useCallback(() => {
    setSignupPath('manual')
    setUnitMetadata(null)
    setParsedRoster(null)
    setRosterSummary(null)
    setCurrentStep(1)
    setError(null)
  }, [])

  // ============================================
  // Submit
  // ============================================

  const handleSubmit = useCallback(async (confirmDuplicateOverride = false) => {
    if (!unitMetadata) {
      setError('Missing unit data. Please start over.')
      return
    }

    setIsLoading(true)
    setError(null)
    setDuplicateWarning(null)

    try {
      const result = await provisionUnitAuthenticated({
        unitMetadata,
        parsedAdults: parsedRoster?.adults || [],
        parsedScouts: parsedRoster?.scouts || [],
        signupPath,
        confirmDuplicateOverride,
      })

      if (result.duplicateWarning?.exists && !confirmDuplicateOverride) {
        setDuplicateWarning({
          existingUnitName: result.duplicateWarning.existingUnitName,
          existingUnitType: result.duplicateWarning.existingUnitType,
          existingUnitNumber: result.duplicateWarning.existingUnitNumber,
          existingCouncil: result.duplicateWarning.existingCouncil,
        })
        setIsLoading(false)
        return
      }

      if (!result.success) {
        setError(result.error || 'Failed to create unit')
        setIsLoading(false)
        return
      }

      setIsComplete(true)
      setIsLoading(false)

      // Redirect to dashboard. Use full navigation (not router.push) so the
      // dashboard layout re-runs with the new membership instead of using its
      // cached server-render.
      setTimeout(() => {
        window.location.href = `/scouts?unit=${result.unitId}`
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsLoading(false)
    }
  }, [unitMetadata, parsedRoster, signupPath])

  // ============================================
  // Render: Success
  // ============================================

  if (isComplete) {
    return (
      <FadeIn className="text-center py-8">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-success/10 text-success mb-4">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Unit created!
        </h2>
        <p className="text-stone-600 dark:text-stone-300 max-w-md mx-auto">
          {rosterSummary && rosterSummary.scoutCount > 0
            ? `Your unit has been created with ${rosterSummary.scoutCount} scouts and ${rosterSummary.adultCount} adults. Redirecting to your dashboard...`
            : 'Your unit has been created. Redirecting to your dashboard...'}
        </p>
      </FadeIn>
    )
  }

  // ============================================
  // Render: Upload Step
  // ============================================

  const renderUploadStep = () => (
    <FadeIn>
      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 p-4">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-forest-600" />
            <div>
              <p className="font-medium text-stone-900 dark:text-stone-100">{file.name}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {isParsing ? 'Parsing roster...' : 'Ready to preview'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFile} disabled={isParsing}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
            isDragging
              ? 'border-forest-500 bg-forest-50 dark:bg-forest-900/20'
              : 'border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800/50 hover:border-stone-400 dark:hover:border-stone-500'
          }`}
        >
          <Upload className={`h-12 w-12 ${isDragging ? 'text-forest-500' : 'text-stone-400 dark:text-stone-500'}`} />
          <p className="mt-4 text-center text-stone-600 dark:text-stone-300">
            Drag and drop your BSA roster CSV file here, or
          </p>
          <label className="mt-2 cursor-pointer">
            <span className="text-forest-600 dark:text-forest-400 hover:text-forest-700 dark:hover:text-forest-300 font-medium">
              browse to select
            </span>
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={handleFileSelect}
            />
          </label>
          <div className="mt-6 text-sm text-stone-500 dark:text-stone-400 text-center">
            <p className="font-medium mb-1">How to export your roster:</p>
            <ol className="text-left list-decimal list-inside space-y-1">
              <li>Go to my.scouting.org</li>
              <li>Navigate to Roster &rarr; Unit Roster</li>
              <li>Click Export &rarr; Export All to CSV</li>
            </ol>
          </div>
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-stone-200 dark:border-stone-700 text-center">
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-2">
          Don&apos;t have your roster CSV ready?
        </p>
        <button
          type="button"
          onClick={handleSkipForNow}
          className="text-sm font-medium text-forest-600 dark:text-forest-400 hover:text-forest-700 dark:hover:text-forest-300 underline underline-offset-2"
        >
          Skip for now and enter unit details manually
        </button>
      </div>
    </FadeIn>
  )

  // ============================================
  // Render: Confirm/Edit Unit (CSV path)
  // ============================================

  const renderConfirmStep = () => {
    const validateAndSubmit = () => {
      const errors: { unitNumber?: string } = {}
      if (!manualUnitInfo.unitNumber.trim()) {
        errors.unitNumber = 'Unit number is required'
      } else if (!/^\d+$/.test(manualUnitInfo.unitNumber.trim())) {
        errors.unitNumber = 'Unit number must contain only digits'
      }
      setValidationErrors(errors)
      if (Object.keys(errors).length > 0) return

      const metadata: UnitMetadata = {
        unitType: manualUnitInfo.unitType,
        unitNumber: manualUnitInfo.unitNumber.trim(),
        unitSuffix: manualUnitInfo.unitSuffix.trim() || null,
        council: manualUnitInfo.council.trim() || null,
        district: manualUnitInfo.district.trim() || null,
      }
      setUnitMetadata(metadata)
      // Submit directly — no admin step needed
      setIsLoading(true)
      setError(null)
      provisionUnitAuthenticated({
        unitMetadata: metadata,
        parsedAdults: parsedRoster?.adults || [],
        parsedScouts: parsedRoster?.scouts || [],
        signupPath,
      }).then((result) => {
        if (result.duplicateWarning?.exists) {
          setDuplicateWarning({
            existingUnitName: result.duplicateWarning.existingUnitName,
            existingUnitType: result.duplicateWarning.existingUnitType,
            existingUnitNumber: result.duplicateWarning.existingUnitNumber,
            existingCouncil: result.duplicateWarning.existingCouncil,
          })
          setIsLoading(false)
          return
        }
        if (!result.success) {
          setError(result.error || 'Failed to create unit')
          setIsLoading(false)
          return
        }
        setIsComplete(true)
        setIsLoading(false)
        setTimeout(() => {
          window.location.href = `/scouts?unit=${result.unitId}`
        }, 2000)
      }).catch((err) => {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setIsLoading(false)
      })
    }

    const handleUnitNumberChange = (value: string) => {
      setManualUnitInfo(prev => ({ ...prev, unitNumber: value }))
      if (validationErrors.unitNumber) {
        setValidationErrors(prev => ({ ...prev, unitNumber: undefined }))
      }
    }

    return (
      <FadeIn className="space-y-6">
        <p className="text-stone-600 dark:text-stone-300 text-center">
          {signupPath === 'csv'
            ? 'We detected this unit from your roster. You can edit the details below if needed.'
            : 'Enter your unit information below. You can add scouts and adults later.'}
        </p>

        <div className="space-y-4">
          {/* Unit Type */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">
              Unit Type <span className="text-amber-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['troop', 'pack', 'crew', 'ship'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setManualUnitInfo(prev => ({ ...prev, unitType: type }))}
                  className={`px-4 py-3 rounded-lg border-2 transition-colors font-medium capitalize ${
                    manualUnitInfo.unitType === type
                      ? 'border-forest-600 bg-forest-50 dark:bg-forest-900/20 text-forest-700 dark:text-forest-300'
                      : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Unit Number and Suffix */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label htmlFor="createUnitNumber" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
                Unit Number <span className="text-amber-500">*</span>
              </label>
              <input
                type="text"
                id="createUnitNumber"
                value={manualUnitInfo.unitNumber}
                onChange={(e) => handleUnitNumberChange(e.target.value)}
                className={`w-full rounded-lg border px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 ${
                  validationErrors.unitNumber
                    ? 'border-error focus:border-error focus:ring-error/20'
                    : 'border-stone-300 dark:border-stone-600 focus:border-forest-600 dark:focus:border-forest-500 focus:ring-forest-600/20 dark:focus:ring-forest-500/30'
                }`}
                placeholder="9297"
              />
              {validationErrors.unitNumber && (
                <p className="mt-1 text-sm text-error">{validationErrors.unitNumber}</p>
              )}
            </div>
            <div>
              <label htmlFor="createUnitSuffix" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
                Suffix
              </label>
              <input
                type="text"
                id="createUnitSuffix"
                value={manualUnitInfo.unitSuffix}
                onChange={(e) => setManualUnitInfo(prev => ({ ...prev, unitSuffix: e.target.value }))}
                className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
                placeholder="B"
                maxLength={2}
              />
            </div>
          </div>

          {/* Council */}
          <div>
            <label htmlFor="createCouncil" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              Council
            </label>
            <input
              type="text"
              id="createCouncil"
              value={manualUnitInfo.council}
              onChange={(e) => setManualUnitInfo(prev => ({ ...prev, council: e.target.value }))}
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
              placeholder="Northern Star Council"
            />
          </div>

          {/* District */}
          <div>
            <label htmlFor="createDistrict" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              District
            </label>
            <input
              type="text"
              id="createDistrict"
              value={manualUnitInfo.district}
              onChange={(e) => setManualUnitInfo(prev => ({ ...prev, district: e.target.value }))}
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
              placeholder="Voyageurs"
            />
          </div>
        </div>

        {/* Roster Preview */}
        {parsedRoster && (parsedRoster.scouts.length > 0 || parsedRoster.adults.length > 0) && (
          <div className="border-t border-stone-200 dark:border-stone-700 pt-6">
            <RosterPreview
              scouts={parsedRoster.scouts}
              adults={parsedRoster.adults}
              errors={parsedRoster.errors}
            />
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={clearFile} className="flex-1">
            {signupPath === 'csv' ? 'Start Over' : 'Back'}
          </Button>
          <Button
            onClick={() => duplicateWarning ? handleSubmit(true) : validateAndSubmit()}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : duplicateWarning ? (
              'Create Anyway'
            ) : (
              'Create Unit'
            )}
          </Button>
        </div>
      </FadeIn>
    )
  }

  // ============================================
  // Render: Main
  // ============================================

  return (
    <div className="space-y-8">
      <TrailMarker steps={signupPath === 'manual' ? STEPS_MANUAL : STEPS_CSV} currentStep={currentStep} className="justify-center" />

      {error && (
        <div className="rounded-lg bg-error-light dark:bg-error/10 border border-error/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-error-dark dark:text-error">{error}</p>
        </div>
      )}

      {duplicateWarning && !isLoading && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                A unit with similar information already exists
              </p>
              <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded-md p-3">
                <p className="font-medium">{duplicateWarning.existingUnitName}</p>
                {duplicateWarning.existingCouncil && (
                  <p className="text-amber-600 dark:text-amber-400 mt-1">{duplicateWarning.existingCouncil}</p>
                )}
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                You can proceed with creating a new unit if this is intentional.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-[300px]">
        {currentStep === 0 && renderUploadStep()}
        {currentStep === 1 && renderConfirmStep()}
      </div>
    </div>
  )
}
