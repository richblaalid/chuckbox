'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/ui/page-transition'
import {
  Puzzle,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Users,
  UserCheck,
} from 'lucide-react'

interface ExtensionConnectProps {
  unitId: string
  onComplete: () => Promise<void>
  onBack: () => void
  isCompleting?: boolean
}

interface SyncStatus {
  hasPending: boolean
  sessionId?: string
  members?: Array<{
    id: string
    firstName: string
    lastName: string
    memberType: 'YOUTH' | 'LEADER' | 'P 18+'
    changeType: 'create' | 'update' | 'skip'
    bsaMemberId?: string
    rank?: string
    patrol?: string
  }>
  summary?: {
    toCreate: number
    toUpdate: number
    toSkip: number
    adultsToCreate: number
    adultsToUpdate: number
  }
}

interface ImportResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  errors: number
  adultsCreated: number
  adultsUpdated: number
}

type Step = 'install' | 'token' | 'waiting' | 'preview' | 'importing' | 'complete'

export function ExtensionConnect({
  unitId,
  onComplete,
  onBack,
  isCompleting = false,
}: ExtensionConnectProps) {
  const [step, setStep] = useState<Step>('install')
  const [extensionToken, setExtensionToken] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [isGeneratingToken, setIsGeneratingToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Filter members by type
  const getScouts = useCallback((members: SyncStatus['members']) => {
    if (!members) return []
    return members
      .filter(m => m.memberType === 'YOUTH' || m.memberType === 'P 18+')
      .filter(m => m.changeType !== 'skip')
  }, [])

  const getAdults = useCallback((members: SyncStatus['members']) => {
    if (!members) return []
    return members
      .filter(m => m.memberType === 'LEADER')
      .filter(m => m.changeType !== 'skip')
  }, [])

  // Poll for pending sync
  const checkPendingSync = useCallback(async () => {
    try {
      const response = await fetch('/api/scoutbook/sync/pending')
      const data = await response.json()

      if (data.hasPending) {
        setSyncStatus(data)
        setStep('preview')
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  // Start polling when in waiting step
  useEffect(() => {
    if (step !== 'waiting') {
      setIsPolling(false)
      return
    }

    setIsPolling(true)
    setPollCount(0)

    const pollInterval = setInterval(async () => {
      setPollCount(prev => prev + 1)
      const hasPending = await checkPendingSync()
      if (hasPending) {
        clearInterval(pollInterval)
        setIsPolling(false)
      }
    }, 3000) // Poll every 3 seconds

    return () => {
      clearInterval(pollInterval)
      setIsPolling(false)
    }
  }, [step, checkPendingSync])

  // Check for existing pending sync on mount
  useEffect(() => {
    checkPendingSync()
  }, [checkPendingSync])

  const handleGenerateToken = async () => {
    setIsGeneratingToken(true)
    setError(null)

    try {
      const response = await fetch('/api/scoutbook/extension-auth', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate token')
      }

      setExtensionToken(data.token)
      setTokenExpiresAt(data.expiresAt)
      setStep('token')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token')
    } finally {
      setIsGeneratingToken(false)
    }
  }

  const handleCopyToken = async () => {
    if (!extensionToken) return
    try {
      await navigator.clipboard.writeText(extensionToken)
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 3000)
    } catch {
      setError('Failed to copy token to clipboard')
    }
  }

  const handleProceedToWaiting = () => {
    setStep('waiting')
  }

  const handleConfirmImport = async () => {
    if (!syncStatus?.sessionId) return

    setIsImporting(true)
    setError(null)

    try {
      const response = await fetch('/api/scoutbook/sync/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: syncStatus.sessionId,
          // Select all for setup wizard (simplified)
          selectedScoutIds: syncStatus.members
            ?.filter(m => m.memberType !== 'LEADER' && m.changeType !== 'skip')
            .map(m => m.id) || [],
          selectedAdultIds: syncStatus.members
            ?.filter(m => m.memberType === 'LEADER' && m.changeType !== 'skip')
            .map(m => m.id) || [],
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to confirm import')
      }

      setImportResult({
        success: true,
        created: data.created,
        updated: data.updated,
        skipped: data.skipped,
        errors: data.errors || 0,
        adultsCreated: data.adultsCreated || 0,
        adultsUpdated: data.adultsUpdated || 0,
      })

      // Complete the setup wizard
      await onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import')
      setIsImporting(false)
    }
  }

  const handleCancelSync = async () => {
    if (!syncStatus?.sessionId) return

    try {
      await fetch('/api/scoutbook/sync/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: syncStatus.sessionId }),
      })

      setSyncStatus(null)
      setStep('waiting')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sync')
    }
  }

  const handleBack = () => {
    if (step === 'token') {
      setStep('install')
    } else if (step === 'waiting') {
      setStep('token')
    } else if (step === 'preview') {
      handleCancelSync()
    } else {
      onBack()
    }
  }

  const scouts = getScouts(syncStatus?.members)
  const adults = getAdults(syncStatus?.members)

  return (
    <FadeIn className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Connect Browser Extension
        </h2>
        <p className="text-stone-600 dark:text-stone-300">
          {step === 'install' && 'Install our Chrome extension to sync your roster directly from Scoutbook.'}
          {step === 'token' && 'Copy this token and paste it in the extension to connect.'}
          {step === 'waiting' && 'Waiting for the extension to sync your roster...'}
          {step === 'preview' && 'Review the roster from Scoutbook before importing.'}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-error-light dark:bg-error/10 border border-error/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-error flex-shrink-0 mt-0.5" />
          <p className="text-sm text-error-dark dark:text-error">{error}</p>
        </div>
      )}

      {/* Step: Install Extension */}
      {step === 'install' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-forest-100 dark:bg-forest-900/30 flex items-center justify-center flex-shrink-0">
                <Puzzle className="h-6 w-6 text-forest-600 dark:text-forest-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-2">
                  1. Install the Extension
                </h3>
                <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
                  Add the Chuckbox Sync extension to your Chrome browser. It runs only when you&apos;re on Scoutbook.
                </p>
                <a
                  href="https://chrome.google.com/webstore/category/extensions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-forest-600 dark:text-forest-400 hover:underline"
                >
                  Get from Chrome Web Store
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-stone-100 dark:bg-stone-700 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-semibold text-stone-600 dark:text-stone-300">2</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-2">
                  Generate Connection Token
                </h3>
                <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
                  Create a secure token to link the extension to your unit. The token expires in 60 days.
                </p>
                <Button
                  onClick={handleGenerateToken}
                  disabled={isGeneratingToken}
                >
                  {isGeneratingToken ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate Token'
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button variant="outline" onClick={() => onComplete()}>
              Skip for Now
            </Button>
          </div>
        </div>
      )}

      {/* Step: Copy Token */}
      {step === 'token' && extensionToken && (
        <div className="space-y-6">
          <div className="rounded-lg border border-forest-200 dark:border-forest-800 bg-forest-50 dark:bg-forest-900/20 p-6">
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-2">
              Your Connection Token
            </h3>
            <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
              Copy this token and paste it in the extension settings. The token is only shown once.
            </p>

            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-4 py-3 text-sm font-mono text-stone-900 dark:text-stone-100 truncate">
                {extensionToken}
              </code>
              <Button
                variant="outline"
                onClick={handleCopyToken}
                className="flex-shrink-0"
              >
                {tokenCopied ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-success" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </div>

            {tokenExpiresAt && (
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
                Expires: {new Date(tokenExpiresAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6">
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-2">
              Next Steps
            </h3>
            <ol className="text-sm text-stone-600 dark:text-stone-300 space-y-2 list-decimal list-inside">
              <li>Open the Chuckbox extension in your browser</li>
              <li>Paste the token in the extension settings</li>
              <li>Navigate to Scoutbook and open your roster</li>
              <li>Click &quot;Sync to Chuckbox&quot; in the extension</li>
            </ol>
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
            <Button onClick={handleProceedToWaiting}>
              I&apos;ve Installed the Extension
            </Button>
          </div>
        </div>
      )}

      {/* Step: Waiting for Extension */}
      {step === 'waiting' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-8 text-center">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-forest-100 dark:bg-forest-900/30 mb-4">
              <RefreshCw className={`h-8 w-8 text-forest-600 dark:text-forest-400 ${isPolling ? 'animate-spin' : ''}`} />
            </div>
            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-2">
              Waiting for Extension Sync
            </h3>
            <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
              Open Scoutbook in your browser and click &quot;Sync to Chuckbox&quot; in the extension.
            </p>
            {isPolling && (
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Checking for sync data... ({pollCount})
              </p>
            )}
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
            <Button variant="outline" onClick={() => onComplete()}>
              Skip for Now
            </Button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && syncStatus && (
        <div className="space-y-6">
          {syncStatus.summary && (
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="rounded-lg bg-forest-50 dark:bg-forest-900/20 p-3">
                <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">
                  {syncStatus.summary.toCreate}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">New Scouts</p>
              </div>
              <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 p-3">
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">
                  {syncStatus.summary.toUpdate}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">Updates</p>
              </div>
              <div className="rounded-lg bg-forest-50 dark:bg-forest-900/20 p-3">
                <p className="text-2xl font-bold text-forest-700 dark:text-forest-300">
                  {syncStatus.summary.adultsToCreate || 0}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">New Adults</p>
              </div>
              <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 p-3">
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">
                  {syncStatus.summary.adultsToUpdate || 0}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">Adult Updates</p>
              </div>
            </div>
          )}

          {/* Scouts List */}
          {scouts.length > 0 && (
            <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden">
              <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center gap-2">
                <Users className="h-5 w-5 text-forest-600" />
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">
                  Scouts ({scouts.length})
                </h3>
              </div>
              <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                {scouts.map((scout) => (
                  <div
                    key={scout.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md bg-stone-50 dark:bg-stone-700/50"
                  >
                    <div>
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {scout.firstName} {scout.lastName}
                      </span>
                      {scout.patrol && (
                        <span className="ml-2 text-sm text-stone-500 dark:text-stone-400">
                          {scout.patrol}
                        </span>
                      )}
                    </div>
                    {scout.rank && (
                      <span className="text-sm text-stone-500 dark:text-stone-400">
                        {scout.rank}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adults List */}
          {adults.length > 0 && (
            <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden">
              <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-forest-600" />
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">
                  Adults ({adults.length})
                </h3>
              </div>
              <div className="max-h-32 overflow-y-auto p-2 space-y-1">
                {adults.map((adult) => (
                  <div
                    key={adult.id}
                    className="flex items-center px-3 py-2 rounded-md bg-stone-50 dark:bg-stone-700/50"
                  >
                    <span className="font-medium text-stone-900 dark:text-stone-100">
                      {adult.firstName} {adult.lastName}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={handleBack} disabled={isImporting || isCompleting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting || isCompleting}>
              {isImporting || isCompleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import Roster'
              )}
            </Button>
          </div>
        </div>
      )}
    </FadeIn>
  )
}
