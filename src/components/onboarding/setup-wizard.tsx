'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TrailMarker } from '@/components/ui/trail-marker'
import { SuccessCelebration } from '@/components/ui/success-animation'
import { FadeIn } from '@/components/ui/page-transition'
import { Button } from '@/components/ui/button'
import { completeSetupWizard } from '@/app/actions/onboarding'
import { Users, Building2, ArrowRight, Loader2, CheckCircle, Upload, UserPlus, Puzzle } from 'lucide-react'

// Steps for units that already have roster (CSV uploaded during signup)
const STEPS_WITH_ROSTER = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'review', label: 'Review' },
  { id: 'complete', label: 'Done' },
]

// Steps for units that need setup (skipped CSV during signup)
const STEPS_NEEDS_SETUP = [
  { id: 'choose', label: 'Choose Path' },
  { id: 'setup', label: 'Add Roster' },
  { id: 'complete', label: 'Done' },
]

type SetupPath = 'csv' | 'manual' | 'extension' | null

interface SetupWizardProps {
  unitId: string
  unitName: string
  unitType: string
  council: string | null
  needsSetup?: boolean
  rosterSummary: {
    adultCount: number
    scoutCount: number
    patrolCount: number
    patrols: string[]
  }
}

export function SetupWizard({
  unitId,
  unitName,
  unitType,
  council,
  needsSetup = false,
  rosterSummary,
}: SetupWizardProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [isCompleting, setIsCompleting] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [selectedPath, setSelectedPath] = useState<SetupPath>(null)

  // Determine which flow to show:
  // - If needsSetup is true and no roster: show path selection
  // - Otherwise: show the existing welcome/review flow
  const hasRoster = rosterSummary.scoutCount > 0 || rosterSummary.adultCount > 0
  const showPathSelection = needsSetup && !hasRoster
  const steps = showPathSelection ? STEPS_NEEDS_SETUP : STEPS_WITH_ROSTER

  const handleComplete = async () => {
    setIsCompleting(true)
    const result = await completeSetupWizard()
    if (result.success) {
      setShowCelebration(true)
      setCurrentStep(2)
    }
    setIsCompleting(false)
  }

  const handleGoToDashboard = () => {
    router.push('/dashboard')
  }

  // ============================================
  // Path Selection Step (for needs_setup flow)
  // ============================================

  const renderPathSelectionStep = () => (
    <FadeIn className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Welcome to {unitName}!
        </h2>
        <p className="text-stone-600 dark:text-stone-300">
          Let&apos;s get your roster set up. Choose how you&apos;d like to add your scouts and adults.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* CSV Upload Option */}
        <button
          type="button"
          onClick={() => setSelectedPath('csv')}
          className={`rounded-lg border-2 p-6 text-left transition-all hover:shadow-md ${
            selectedPath === 'csv'
              ? 'border-forest-600 bg-forest-50 dark:bg-forest-900/20'
              : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800'
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
              selectedPath === 'csv'
                ? 'bg-forest-600 text-white'
                : 'bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300'
            }`}>
              <Upload className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Upload CSV</h3>
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Import your roster from a BSA CSV export file. This is the fastest way to get started.
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Recommended
          </p>
        </button>

        {/* Manual Entry Option */}
        <button
          type="button"
          onClick={() => setSelectedPath('manual')}
          className={`rounded-lg border-2 p-6 text-left transition-all hover:shadow-md ${
            selectedPath === 'manual'
              ? 'border-forest-600 bg-forest-50 dark:bg-forest-900/20'
              : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800'
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
              selectedPath === 'manual'
                ? 'bg-forest-600 text-white'
                : 'bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300'
            }`}>
              <UserPlus className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Enter Manually</h3>
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Add scouts and adults one by one. Great for small units or if you don&apos;t have a CSV.
          </p>
        </button>

        {/* Extension Sync Option */}
        <button
          type="button"
          onClick={() => setSelectedPath('extension')}
          className={`rounded-lg border-2 p-6 text-left transition-all hover:shadow-md ${
            selectedPath === 'extension'
              ? 'border-forest-600 bg-forest-50 dark:bg-forest-900/20'
              : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800'
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
              selectedPath === 'extension'
                ? 'bg-forest-600 text-white'
                : 'bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300'
            }`}>
              <Puzzle className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Browser Extension</h3>
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Install our extension to sync directly from Scoutbook. Keeps data up to date automatically.
          </p>
        </button>
      </div>

      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={handleGoToDashboard}>
          Skip for now
        </Button>
        <Button
          onClick={() => setCurrentStep(1)}
          disabled={!selectedPath}
          size="lg"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </FadeIn>
  )

  // ============================================
  // Setup Step (based on selected path)
  // ============================================

  const renderSetupStep = () => {
    if (selectedPath === 'csv') {
      return (
        <FadeIn className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
              Upload Your Roster
            </h2>
            <p className="text-stone-600 dark:text-stone-300">
              Export your roster from my.scouting.org and upload it here.
            </p>
          </div>

          <div className="bg-stone-50 dark:bg-stone-800 rounded-lg p-6 text-center">
            <p className="text-stone-500 dark:text-stone-400">
              CSV upload component will be integrated here.
            </p>
            <p className="text-sm text-stone-400 dark:text-stone-500 mt-2">
              (Task 2.2.1 - Reuse existing CSV upload/preview components)
            </p>
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={() => { setSelectedPath(null); setCurrentStep(0) }}>
              Back
            </Button>
            <Button onClick={handleComplete} disabled={isCompleting} size="lg">
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  Complete Setup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </FadeIn>
      )
    }

    if (selectedPath === 'manual') {
      return (
        <FadeIn className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
              Add Your Roster
            </h2>
            <p className="text-stone-600 dark:text-stone-300">
              You can add scouts and adults now, or skip and add them later from the Roster page.
            </p>
          </div>

          <div className="bg-stone-50 dark:bg-stone-800 rounded-lg p-6 text-center">
            <p className="text-stone-500 dark:text-stone-400">
              Manual entry forms will be integrated here.
            </p>
            <p className="text-sm text-stone-400 dark:text-stone-500 mt-2">
              (Tasks 2.3.1-2.3.5 - Create AddScoutForm, AddPatrolForm, etc.)
            </p>
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={() => { setSelectedPath(null); setCurrentStep(0) }}>
              Back
            </Button>
            <Button onClick={handleComplete} disabled={isCompleting} size="lg">
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  Complete Setup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </FadeIn>
      )
    }

    if (selectedPath === 'extension') {
      return (
        <FadeIn className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
              Connect Browser Extension
            </h2>
            <p className="text-stone-600 dark:text-stone-300">
              Install our Chrome extension to sync data directly from Scoutbook.
            </p>
          </div>

          <div className="bg-stone-50 dark:bg-stone-800 rounded-lg p-6 text-center">
            <p className="text-stone-500 dark:text-stone-400">
              Extension installation and sync UI will be integrated here.
            </p>
            <p className="text-sm text-stone-400 dark:text-stone-500 mt-2">
              (Tasks 2.4.1-2.4.6 - Extension connection flow)
            </p>
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={() => { setSelectedPath(null); setCurrentStep(0) }}>
              Back
            </Button>
            <Button onClick={handleComplete} disabled={isCompleting} size="lg">
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  Complete Setup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </FadeIn>
      )
    }

    // Fallback - shouldn't happen
    return null
  }

  // ============================================
  // Step 0: Welcome (for units with roster)
  // ============================================

  const renderWelcomeStep = () => (
    <FadeIn className="text-center space-y-8">
      <div className="relative">
        <SuccessCelebration
          show={true}
          message={`Welcome to ${unitName}!`}
          subMessage="Your unit has been created and your roster imported."
        />
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
          <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.scoutCount}</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">Scouts</p>
        </div>
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
          <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.adultCount}</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">Adults</p>
        </div>
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4 text-center">
          <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">{rosterSummary.patrolCount}</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">Patrols</p>
        </div>
      </div>

      <Button onClick={() => setCurrentStep(1)} size="lg" className="min-w-[200px]">
        Continue Setup
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </FadeIn>
  )

  // ============================================
  // Step 1: Review
  // ============================================

  const renderReviewStep = () => (
    <FadeIn className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Review Your Unit
        </h2>
        <p className="text-stone-600 dark:text-stone-300">
          Here&apos;s what we imported from your roster. You can update these later from the Settings page.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Unit Info */}
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-forest-100 dark:bg-forest-900 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-forest-600 dark:text-forest-400" />
            </div>
            <div>
              <h3 className="font-semibold text-stone-900 dark:text-stone-100">{unitName}</h3>
              {council && (
                <p className="text-sm text-stone-500 dark:text-stone-400">{council}</p>
              )}
            </div>
          </div>
          <div className="text-sm text-stone-600 dark:text-stone-300">
            <p>Unit Type: {unitType.charAt(0).toUpperCase() + unitType.slice(1)}</p>
          </div>
        </div>

        {/* Roster Summary */}
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-forest-100 dark:bg-forest-900 flex items-center justify-center">
              <Users className="h-5 w-5 text-forest-600 dark:text-forest-400" />
            </div>
            <div>
              <h3 className="font-semibold text-stone-900 dark:text-stone-100">Roster</h3>
              <p className="text-sm text-stone-500 dark:text-stone-400">Imported from BSA</p>
            </div>
          </div>
          <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
            <p>{rosterSummary.scoutCount} scouts imported</p>
            <p>{rosterSummary.adultCount} adults imported</p>
            {rosterSummary.patrolCount > 0 && (
              <p>{rosterSummary.patrolCount} patrols: {rosterSummary.patrols.join(', ')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Next Steps Preview */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
        <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">What&apos;s next?</h3>
        <ul className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span>Invite other leaders to help manage the unit</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span>Set up billing and create your first fair share bill</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span>Connect payment processing to collect payments online</span>
          </li>
        </ul>
      </div>

      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(0)}>
          Back
        </Button>
        <Button onClick={handleComplete} disabled={isCompleting} size="lg">
          {isCompleting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finishing...
            </>
          ) : (
            <>
              Complete Setup
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </FadeIn>
  )

  // ============================================
  // Step 2: Complete
  // ============================================

  const renderCompleteStep = () => (
    <FadeIn className="text-center space-y-8">
      {showCelebration && (
        <SuccessCelebration
          show={true}
          message="You're all set!"
          subMessage="Your unit is ready to go."
        />
      )}

      <div className="space-y-4 pt-8">
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200">
          Setup Complete
        </h2>
        <p className="text-stone-600 dark:text-stone-300 max-w-md mx-auto">
          You can now start managing your unit. Explore the dashboard to invite leaders,
          create bills, and track scout accounts.
        </p>
      </div>

      <Button onClick={handleGoToDashboard} size="lg" className="min-w-[200px]">
        Go to Dashboard
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </FadeIn>
  )

  // ============================================
  // Main Render
  // ============================================

  return (
    <div className="space-y-8">
      {/* Progress indicator */}
      <div className="flex justify-center">
        <TrailMarker steps={steps} currentStep={currentStep} />
      </div>

      {/* Step content */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-cream-400 dark:border-stone-700 p-8 shadow-lg">
        {showPathSelection ? (
          // Needs setup flow (skipped CSV during signup)
          <>
            {currentStep === 0 && renderPathSelectionStep()}
            {currentStep === 1 && renderSetupStep()}
            {currentStep === 2 && renderCompleteStep()}
          </>
        ) : (
          // Has roster flow (CSV uploaded during signup)
          <>
            {currentStep === 0 && renderWelcomeStep()}
            {currentStep === 1 && renderReviewStep()}
            {currentStep === 2 && renderCompleteStep()}
          </>
        )}
      </div>
    </div>
  )
}
