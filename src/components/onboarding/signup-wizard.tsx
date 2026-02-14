'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, X, Users, Building2, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TrailMarker } from '@/components/ui/trail-marker'
import { FadeIn } from '@/components/ui/page-transition'
import { parseRosterWithMetadata, type ParsedRoster, type UnitMetadata } from '@/lib/import/bsa-roster-parser'
import { extractUnitFromCSV, provisionUnit } from '@/app/actions/onboarding'

const STEPS = [
  { id: 'upload', label: 'Upload Roster' },
  { id: 'confirm', label: 'Confirm Unit' },
  { id: 'admin', label: 'Your Info' },
]

interface SignupWizardProps {
  onComplete?: () => void
}

export function SignupWizard({ onComplete }: SignupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingUnitName: string } | null>(null)

  // Step 1: File upload state
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)

  // Step 2: Unit confirmation state
  const [unitMetadata, setUnitMetadata] = useState<UnitMetadata | null>(null)
  const [rosterSummary, setRosterSummary] = useState<{ adultCount: number; scoutCount: number; patrolCount: number } | null>(null)
  const [parsedRoster, setParsedRoster] = useState<ParsedRoster | null>(null)

  // Step 3: Admin info state
  const [adminInfo, setAdminInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
  })

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
      setIsParsing(false)
      setCurrentStep(1) // Move to confirmation step
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
    if (droppedFile) {
      processFile(droppedFile)
    }
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
    if (selectedFile) {
      processFile(selectedFile)
    }
  }, [processFile])

  const clearFile = useCallback(() => {
    setFile(null)
    setUnitMetadata(null)
    setRosterSummary(null)
    setParsedRoster(null)
    setCurrentStep(0)
    setError(null)
  }, [])

  // ============================================
  // Step 3: Submit
  // ============================================

  const handleSubmit = useCallback(async (confirmDuplicateOverride = false) => {
    if (!unitMetadata || !parsedRoster) {
      setError('Missing unit data. Please start over.')
      return
    }

    if (!adminInfo.firstName || !adminInfo.lastName || !adminInfo.email) {
      setError('Please fill in all fields')
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(adminInfo.email)) {
      setError('Please enter a valid email address')
      return
    }

    setIsLoading(true)
    setError(null)
    setDuplicateWarning(null)

    try {
      // Get IP address from request headers (will be done server-side)
      const result = await provisionUnit(
        {
          unitMetadata,
          admin: adminInfo,
          parsedAdults: parsedRoster.adults,
          parsedScouts: parsedRoster.scouts,
          confirmDuplicateOverride,
        },
        '0.0.0.0' // IP will be captured server-side via headers
      )

      // Handle duplicate warning (soft block - user can confirm to proceed)
      if (result.duplicateWarning?.exists) {
        setDuplicateWarning({ existingUnitName: result.duplicateWarning.existingUnitName })
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
      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsLoading(false)
    }
  }, [unitMetadata, parsedRoster, adminInfo, onComplete])

  // ============================================
  // Render: Success State
  // ============================================

  if (isComplete) {
    return (
      <FadeIn className="text-center py-8">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-success/10 text-success mb-4">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Check your email!
        </h2>
        <p className="text-stone-600 dark:text-stone-300 max-w-md mx-auto">
          We&apos;ve sent a verification link to <strong>{adminInfo.email}</strong>.
          Click the link to complete your signup and activate your unit.
        </p>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-4">
          The link will expire in 24 hours.
        </p>
      </FadeIn>
    )
  }

  // ============================================
  // Render: Step 1 - Upload
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
    </FadeIn>
  )

  // ============================================
  // Render: Step 2 - Confirm Unit
  // ============================================

  const renderConfirmStep = () => {
    if (!unitMetadata) return null

    const unitTypeName = unitMetadata.unitType
      ? unitMetadata.unitType.charAt(0).toUpperCase() + unitMetadata.unitType.slice(1)
      : 'Unit'
    const unitDisplayName = unitMetadata.unitSuffix
      ? `${unitTypeName} ${unitMetadata.unitNumber}${unitMetadata.unitSuffix}`
      : `${unitTypeName} ${unitMetadata.unitNumber}`

    return (
      <FadeIn className="space-y-6">
        <div className="rounded-lg border border-forest-200 dark:border-forest-700 bg-forest-50 dark:bg-forest-900/20 p-6">
          <div className="flex items-start gap-4">
            <div className="shrink-0 h-12 w-12 rounded-full bg-forest-100 dark:bg-forest-800 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-forest-600 dark:text-forest-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-forest-800 dark:text-forest-200">
                {unitDisplayName}
              </h3>
              {unitMetadata.council && (
                <p className="text-stone-600 dark:text-stone-300">{unitMetadata.council}</p>
              )}
              {unitMetadata.district && (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  District: {unitMetadata.district}
                </p>
              )}
            </div>
          </div>
        </div>

        {rosterSummary && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
              <Users className="h-6 w-6 text-stone-400 dark:text-stone-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.scoutCount}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">Scouts</p>
            </div>
            <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
              <Users className="h-6 w-6 text-stone-400 dark:text-stone-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.adultCount}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">Adults</p>
            </div>
            <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
              <Users className="h-6 w-6 text-stone-400 dark:text-stone-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.patrolCount}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">Patrols</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={clearFile} className="flex-1">
            This isn&apos;t right
          </Button>
          <Button onClick={() => setCurrentStep(2)} className="flex-1">
            Continue
          </Button>
        </div>
      </FadeIn>
    )
  }

  // ============================================
  // Render: Step 3 - Admin Info
  // ============================================

  const renderAdminStep = () => (
    <FadeIn className="space-y-6">
      <p className="text-stone-600 dark:text-stone-300 text-center">
        You&apos;ll be the first administrator for this unit. Enter your information to get started.
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              First Name <span className="text-amber-500">*</span>
            </label>
            <input
              type="text"
              id="firstName"
              value={adminInfo.firstName}
              onChange={(e) => setAdminInfo(prev => ({ ...prev, firstName: e.target.value }))}
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
              placeholder="First name"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              Last Name <span className="text-amber-500">*</span>
            </label>
            <input
              type="text"
              id="lastName"
              value={adminInfo.lastName}
              onChange={(e) => setAdminInfo(prev => ({ ...prev, lastName: e.target.value }))}
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
              placeholder="Last name"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
            Email Address <span className="text-amber-500">*</span>
          </label>
          <input
            type="email"
            id="email"
            value={adminInfo.email}
            onChange={(e) => setAdminInfo(prev => ({ ...prev, email: e.target.value }))}
            className="w-full rounded-lg border border-stone-300 dark:border-stone-600 px-4 py-2.5 text-stone-900 dark:text-stone-50 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:border-forest-600 dark:focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-600/20 dark:focus:ring-forest-500/30"
            placeholder="you@example.com"
          />
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            We&apos;ll send a verification link to this email
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
          Back
        </Button>
        <Button
          onClick={() => handleSubmit()}
          disabled={isLoading || !adminInfo.firstName || !adminInfo.lastName || !adminInfo.email}
          className="flex-1"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Unit'
          )}
        </Button>
      </div>
    </FadeIn>
  )

  // ============================================
  // Render: Main
  // ============================================

  return (
    <div className="space-y-8">
      {/* Progress indicator */}
      <TrailMarker steps={STEPS} currentStep={currentStep} className="justify-center" />

      {/* Error message */}
      {error && (
        <div className="rounded-lg bg-error-light dark:bg-error/10 border border-error/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-error-dark dark:text-error">{error}</p>
          </div>
        </div>
      )}

      {/* Duplicate unit warning - soft block with confirmation option */}
      {duplicateWarning && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                A unit with similar information already exists
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                We found an existing unit called &ldquo;{duplicateWarning.existingUnitName}&rdquo; that matches this information.
                If this is your unit, please contact support. Otherwise, you can proceed with creating a new unit.
              </p>
            </div>
          </div>
          <div className="flex gap-3 ml-8">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDuplicateWarning(null)}
              className="border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            >
              Go Back
            </Button>
            <Button
              size="sm"
              onClick={() => handleSubmit(true)}
              disabled={isLoading}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Anyway'
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="min-h-[300px]">
        {currentStep === 0 && renderUploadStep()}
        {currentStep === 1 && renderConfirmStep()}
        {currentStep === 2 && renderAdminStep()}
      </div>
    </div>
  )
}
