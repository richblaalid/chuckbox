'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { SyncProgress, FieldConflict, ConflictResolution } from '@/lib/sync/scoutbook/types'
import { StagedMember } from '@/lib/sync/scoutbook'

interface SyncResultDisplay {
  success: boolean
  created: number
  updated: number
  skipped: number
  errors: number
  // Adults
  adultsCreated: number
  adultsUpdated: number
  adultsLinked: number
}

interface StagingSummary {
  toCreate: number
  toUpdate: number
  toSkip: number
  total: number
  // Adults
  adultsToCreate: number
  adultsToUpdate: number
  adultsTotal: number
}

interface CliStatus {
  available: boolean
  installed: boolean
  version: string | null
  browsersInstalled: boolean
  message: string
  reason?: string
}

interface ScoutbookSyncCardProps {
  lastSyncAt?: string | null
  lastSyncMemberCount?: number | null
  isAdmin: boolean
}

export function ScoutbookSyncCard({
  lastSyncAt,
  lastSyncMemberCount,
  isAdmin,
}: ScoutbookSyncCardProps) {
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [isCheckingCli, setIsCheckingCli] = useState(true)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResultDisplay | null>(null)

  // Staging state
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [stagedMembers, setStagedMembers] = useState<StagedMember[]>([])
  const [stagingSummary, setStagingSummary] = useState<StagingSummary | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  // Extension token state
  const [extensionToken, setExtensionToken] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [isGeneratingToken, setIsGeneratingToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [activeTokens, setActiveTokens] = useState<Array<{
    id: string
    expiresAt: string
    lastUsedAt: string | null
  }>>([])

  // Sync history state
  const [syncHistory, setSyncHistory] = useState<Array<{
    id: string
    status: string
    syncSource: string | null
    recordsExtracted: number | null
    completedAt: string | null
    startedAt: string | null
  }>>([])
  const [showSyncHistory, setShowSyncHistory] = useState(false)

  // Selection state for partial acceptance
  const [selectedScoutIds, setSelectedScoutIds] = useState<Set<string>>(new Set())
  const [selectedAdultIds, setSelectedAdultIds] = useState<Set<string>>(new Set())

  // Track field resolution updates (optimistic UI)
  const [fieldResolutionUpdates, setFieldResolutionUpdates] = useState<
    Record<string, Record<string, ConflictResolution>>
  >({})

  // Handler to toggle field resolution
  async function handleFieldResolutionToggle(
    memberId: string,
    field: string,
    newResolution: ConflictResolution
  ) {
    if (!sessionId) return

    // Optimistic update
    setFieldResolutionUpdates((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || {}),
        [field]: newResolution,
      },
    }))

    try {
      const response = await fetch('/api/scoutbook/sync/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          memberId,
          field,
          resolution: newResolution,
        }),
      })

      if (!response.ok) {
        // Revert on error
        setFieldResolutionUpdates((prev) => {
          const updated = { ...prev }
          if (updated[memberId]) {
            delete updated[memberId][field]
            if (Object.keys(updated[memberId]).length === 0) {
              delete updated[memberId]
            }
          }
          return updated
        })
        const data = await response.json()
        setError(data.error || 'Failed to update resolution')
      }
    } catch {
      // Revert on error
      setFieldResolutionUpdates((prev) => {
        const updated = { ...prev }
        if (updated[memberId]) {
          delete updated[memberId][field]
        }
        return updated
      })
    }
  }

  // Get effective resolution for a field (considers optimistic updates)
  function getEffectiveResolution(
    member: StagedMember,
    field: string
  ): ConflictResolution {
    // Check optimistic updates first
    if (fieldResolutionUpdates[member.id]?.[field]) {
      return fieldResolutionUpdates[member.id][field]
    }
    // Fall back to stored value
    return member.fieldResolutions?.[field] || 'chuckbox'
  }

  // Check CLI status, pending syncs, active tokens, and sync history on mount
  useEffect(() => {
    checkCliStatus()
    checkPendingSync()
    fetchActiveTokens()
    fetchSyncHistory()
  }, [])

  async function fetchActiveTokens() {
    try {
      const response = await fetch('/api/scoutbook/extension-auth')
      const data = await response.json()
      if (data.tokens) {
        setActiveTokens(data.tokens)
      }
    } catch {
      // Ignore errors - just means no tokens
    }
  }

  async function fetchSyncHistory() {
    try {
      const response = await fetch('/api/scoutbook/sync/history')
      const data = await response.json()
      if (data.history) {
        setSyncHistory(data.history)
      }
    } catch {
      // Ignore errors - just means no history
    }
  }

  // Initialize selections when staging data loads
  useEffect(() => {
    if (stagedMembers.length > 0) {
      // Initialize scout selections
      const scoutIds = stagedMembers
        .filter((m) => (m.memberType === 'YOUTH' || m.memberType === 'P 18+') && m.changeType !== 'skip')
        .map((m) => m.id)
      setSelectedScoutIds(new Set(scoutIds))

      // Initialize adult selections
      const adultIds = stagedMembers
        .filter((m) => m.memberType === 'LEADER' && m.changeType !== 'skip')
        .map((m) => m.id)
      setSelectedAdultIds(new Set(adultIds))
    }
  }, [stagedMembers])

  async function checkPendingSync() {
    try {
      const response = await fetch('/api/scoutbook/sync/pending')
      const data = await response.json()

      if (data.hasPending) {
        setSessionId(data.sessionId)
        setStagedMembers(data.members)
        setStagingSummary(data.summary)
      }
    } catch {
      // Ignore errors - just means no pending sync
    }
  }

  async function checkCliStatus() {
    setIsCheckingCli(true)
    try {
      const response = await fetch('/api/scoutbook/cli-status')
      const data = await response.json()
      setCliStatus(data)
    } catch {
      setCliStatus({
        available: false,
        installed: false,
        version: null,
        browsersInstalled: false,
        message: 'Could not check CLI status',
      })
    } finally {
      setIsCheckingCli(false)
    }
  }

  async function handleInstallCli() {
    setIsInstalling(true)
    setInstallProgress('Installing agent-browser CLI...')
    setError(null)

    try {
      const response = await fetch('/api/scoutbook/install-cli', {
        method: 'POST',
      })
      const data = await response.json()

      if (data.success) {
        setInstallProgress('Installation complete!')
        // Refresh CLI status
        await checkCliStatus()
      } else {
        setError(data.error || 'Installation failed')
        if (data.suggestion) {
          setError(`${data.error}\n\nTry: ${data.suggestion}`)
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to install agent-browser'
      )
    } finally {
      setIsInstalling(false)
      setInstallProgress(null)
    }
  }

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Never'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  async function handleSync() {
    setIsSyncing(true)
    setError(null)
    setResult(null)
    setStagedMembers([])
    setStagingSummary(null)
    setSessionId(null)
    setSelectedScoutIds(new Set())
    setSelectedAdultIds(new Set())
    setProgress({
      phase: 'login',
      message: 'Starting sync...',
      current: 0,
      total: 1,
      percentComplete: 0,
    })

    try {
      const response = await fetch('/api/scoutbook/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rosterOnly: true }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start sync')
      }

      const data = await response.json()

      if (data.sessionId) {
        setSessionId(data.sessionId)
        await pollForCompletion(data.sessionId)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to sync from Scoutbook'
      )
      setProgress(null)
    } finally {
      setIsSyncing(false)
    }
  }

  async function pollForCompletion(pollSessionId: string) {
    const maxAttempts = 120
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(
          `/api/scoutbook/sync/status?sessionId=${pollSessionId}`
        )
        const data = await response.json()

        if (data.progress) {
          setProgress(data.progress)
        }

        // Handle staged status - show preview
        if (data.status === 'staged') {
          setProgress(null)
          if (data.staging) {
            setStagedMembers(data.staging.members)
            setStagingSummary(data.staging.summary)
          }
          return // Exit polling, wait for user to confirm/cancel
        }

        if (data.status === 'completed') {
          setResult(data.result)
          setProgress(null)
          return
        }

        if (data.status === 'failed') {
          throw new Error(data.error || 'Sync failed')
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
        attempts++
      } catch (err) {
        throw err
      }
    }

    throw new Error('Sync timed out')
  }

  async function handleConfirmImport() {
    if (!sessionId) return

    setIsConfirming(true)
    setError(null)

    try {
      const response = await fetch('/api/scoutbook/sync/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          selectedScoutIds: Array.from(selectedScoutIds),
          selectedAdultIds: Array.from(selectedAdultIds),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to confirm import')
      }

      setResult({
        success: true,
        created: data.created,
        updated: data.updated,
        skipped: data.skipped,
        errors: data.errors,
        adultsCreated: data.adultsCreated || 0,
        adultsUpdated: data.adultsUpdated || 0,
        adultsLinked: data.adultsLinked || 0,
      })
      setStagedMembers([])
      setStagingSummary(null)
      setSessionId(null)
      setSelectedScoutIds(new Set())
      setSelectedAdultIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm import')
    } finally {
      setIsConfirming(false)
    }
  }

  async function handleCancelSync() {
    if (!sessionId) return

    setIsCancelling(true)
    setError(null)

    try {
      const response = await fetch('/api/scoutbook/sync/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel sync')
      }

      setStagedMembers([])
      setStagingSummary(null)
      setSessionId(null)
      setSelectedScoutIds(new Set())
      setSelectedAdultIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sync')
    } finally {
      setIsCancelling(false)
    }
  }

  async function handleGenerateToken() {
    setIsGeneratingToken(true)
    setError(null)
    setExtensionToken(null)
    setTokenCopied(false)

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token')
    } finally {
      setIsGeneratingToken(false)
    }
  }

  async function handleCopyToken() {
    if (!extensionToken) return
    try {
      await navigator.clipboard.writeText(extensionToken)
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 3000)
    } catch {
      setError('Failed to copy token to clipboard')
    }
  }

  const isCliReady = cliStatus?.installed && cliStatus?.browsersInstalled
  const isServerless = cliStatus?.reason === 'serverless'
  const hasStaging = stagedMembers.length > 0
  const showCliAutomation = isFeatureEnabled(FeatureFlag.CLI_AUTOMATION)

  // Helper functions for scout selection
  const importableScouts = stagedMembers.filter((m) => (m.memberType === 'YOUTH' || m.memberType === 'P 18+') && m.changeType !== 'skip')

  function toggleScoutSelection(id: string) {
    setSelectedScoutIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAllScouts() {
    setSelectedScoutIds(new Set(importableScouts.map((m) => m.id)))
  }

  function selectNoScouts() {
    setSelectedScoutIds(new Set())
  }

  // Helper functions for adult selection
  const importableAdults = stagedMembers.filter((m) => m.memberType === 'LEADER' && m.changeType !== 'skip')

  function toggleAdultSelection(id: string) {
    setSelectedAdultIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAllAdults() {
    setSelectedAdultIds(new Set(importableAdults.map((m) => m.id)))
  }

  function selectNoAdults() {
    setSelectedAdultIds(new Set())
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning">
              <svg
                className="h-6 w-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <div>
              <CardTitle>Scoutbook Plus</CardTitle>
              <CardDescription>
                Sync roster and advancement data from BSA
              </CardDescription>
            </div>
          </div>
          {isCheckingCli ? (
            <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-1 text-xs font-medium text-stone-500">
              Checking...
            </span>
          ) : hasStaging ? (
            <span className="inline-flex items-center rounded-full bg-change-skip-light px-2 py-1 text-xs font-medium text-change-skip-foreground">
              Review Required
            </span>
          ) : isServerless ? (
            <span className="inline-flex items-center rounded-full bg-success-light px-2 py-1 text-xs font-medium text-success">
              Available
            </span>
          ) : isCliReady ? (
            <span className="inline-flex items-center rounded-full bg-success-light px-2 py-1 text-xs font-medium text-success">
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-warning-light px-2 py-1 text-xs font-medium text-warning">
              Setup Required
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasStaging && (
          <p className="text-sm text-stone-600">
            Import scout roster and advancement data from Scoutbook Plus.
            {isServerless
              ? ' Use the browser extension or CSV upload to sync your roster.'
              : ' A browser window will open for you to log in securely - Chuckbox never stores your Scoutbook password.'}
          </p>
        )}

        {/* CLI Status Section - Dev only */}
        {showCliAutomation && !isCheckingCli && !isServerless && !hasStaging && (
          <div
            className={`rounded-md p-3 text-sm ${
              isCliReady
                ? 'bg-success-light/50 text-success'
                : 'bg-warning-light text-warning'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {isCliReady ? 'Browser Automation Ready' : 'Setup Required'}
                </p>
                <p className="text-xs opacity-80">
                  {cliStatus?.installed
                    ? 'agent-browser CLI installed'
                    : 'One-time setup needed'}
                </p>
              </div>
              {!isCliReady && isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isInstalling}
                      className="border-warning text-warning hover:bg-warning-light"
                    >
                      {isInstalling ? 'Installing...' : 'Setup'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="max-w-lg">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Install Browser Automation Tool
                      </AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-3 text-left">
                          <p>
                            To sync from Scoutbook, we need to install{' '}
                            <strong>agent-browser</strong>, an open-source tool
                            that automates browser interactions.
                          </p>

                          <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs">
                            <p className="font-medium text-stone-700 dark:text-stone-200">
                              What is agent-browser?
                            </p>
                            <ul className="mt-1 list-inside list-disc space-y-1 text-stone-600">
                              <li>
                                Open-source CLI tool by{' '}
                                <a
                                  href="https://github.com/vercel-labs/agent-browser"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline"
                                >
                                  Vercel Labs
                                </a>
                              </li>
                              <li>
                                Uses Playwright to control a browser window
                              </li>
                              <li>
                                Lets you log into Scoutbook securely (we never
                                see your password)
                              </li>
                              <li>
                                Only runs when you click &quot;Sync&quot; - no
                                background processes
                              </li>
                            </ul>
                          </div>

                          <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs">
                            <p className="font-medium text-stone-700 dark:text-stone-200">
                              What will be installed?
                            </p>
                            <ul className="mt-1 list-inside list-disc space-y-1 text-stone-600">
                              <li>
                                <code className="rounded bg-stone-200 px-1">
                                  agent-browser
                                </code>{' '}
                                npm package (globally)
                              </li>
                              <li>
                                Chromium browser (~150MB, used only for sync)
                              </li>
                            </ul>
                          </div>

                          <div className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs">
                            <p className="font-medium text-warning-dark">
                              Privacy & Security
                            </p>
                            <p className="mt-1 text-warning-dark">
                              Your Scoutbook credentials are entered directly in
                              the browser window - Chuckbox never sees, stores,
                              or transmits your password. The browser session is
                              completely isolated.
                            </p>
                          </div>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleInstallCli}>
                        Install agent-browser
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            {installProgress && (
              <p className="mt-2 text-xs">{installProgress}</p>
            )}
          </div>
        )}


        {/* Staging Preview */}
        {hasStaging && stagingSummary && (
          <div className="space-y-4">
            <div className="rounded-md bg-warning-light border border-warning/30 p-4">
              <h3 className="font-medium text-warning-dark mb-2">
                Review Import
              </h3>
              <p className="text-sm text-warning-dark mb-3">
                The following changes will be made when you confirm:
              </p>

              <Tabs defaultValue="scouts" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="scouts">
                    Scouts ({stagingSummary.toCreate + stagingSummary.toUpdate})
                  </TabsTrigger>
                  <TabsTrigger value="adults">
                    Adults ({(stagingSummary.adultsToCreate || 0) + (stagingSummary.adultsToUpdate || 0)})
                  </TabsTrigger>
                </TabsList>

                {/* Scouts Tab */}
                <TabsContent value="scouts">
                  <div className="grid grid-cols-3 gap-4 text-center mb-4">
                    <div className="rounded-md bg-change-create-light p-3">
                      <p className="text-2xl font-bold text-change-create-foreground">
                        {stagingSummary.toCreate}
                      </p>
                      <p className="text-xs text-change-create-dark">New Scouts</p>
                    </div>
                    <div className="rounded-md bg-change-update-light p-3">
                      <p className="text-2xl font-bold text-change-update-foreground">
                        {stagingSummary.toUpdate}
                      </p>
                      <p className="text-xs text-change-update-dark">Updates</p>
                    </div>
                    <div className="rounded-md bg-change-match-light p-3">
                      <p className="text-2xl font-bold text-change-match-foreground">
                        {selectedScoutIds.size}
                      </p>
                      <p className="text-xs text-change-match-dark">Selected</p>
                    </div>
                  </div>

                  {/* Select all/none controls */}
                  {importableScouts.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 text-xs">
                      <span className="text-stone-500">Select:</span>
                      <Button
                        type="button"
                        variant="link"
                        size="inline"
                        onClick={selectAllScouts}
                      >
                        All
                      </Button>
                      <span className="text-stone-300">|</span>
                      <Button
                        type="button"
                        variant="link"
                        size="inline"
                        onClick={selectNoScouts}
                      >
                        None
                      </Button>
                      <span className="ml-2 text-stone-400">
                        ({selectedScoutIds.size} of {importableScouts.length} selected)
                      </span>
                    </div>
                  )}

                  <div className="max-h-72 overflow-y-auto rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 dark:bg-stone-900 sticky top-0">
                        <tr>
                          <th className="w-8 p-2"></th>
                          <th className="text-left p-2 font-medium">Name</th>
                          <th className="text-left p-2 font-medium">Action</th>
                          <th className="text-left p-2 font-medium">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importableScouts.map((member) => (
                            <tr
                              key={member.id}
                              className={`border-t border-stone-100 dark:border-stone-700 ${
                                !selectedScoutIds.has(member.id) ? 'opacity-50' : ''
                              }`}
                            >
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  checked={selectedScoutIds.has(member.id)}
                                  onChange={() => toggleScoutSelection(member.id)}
                                  className="checkbox-native"
                                />
                              </td>
                              <td className="p-2">
                                <div>
                                  <span>{member.firstName} {member.lastName}</span>
                                  {member.memberType === 'P 18+' && (
                                    <span className="ml-1 inline-flex items-center rounded-full bg-change-skip-light px-1.5 py-0.5 text-[10px] font-medium text-change-skip-foreground">
                                      18+
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                {member.changeType === 'create' && (
                                  <span className="inline-flex items-center rounded-full bg-change-create-light px-2 py-0.5 text-xs font-medium text-change-create-foreground">
                                    Create
                                  </span>
                                )}
                                {member.changeType === 'update' && (
                                  <span className="inline-flex items-center rounded-full bg-change-update-light px-2 py-0.5 text-xs font-medium text-change-update-foreground">
                                    Update
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-xs text-stone-500">
                                {member.changeType === 'create' && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">BSA ID:</span>
                                      <span className="font-mono">{member.bsaMemberId}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Type:</span>
                                      <span>{member.memberType}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Age:</span>
                                      <span>{member.age || '(none)'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Rank:</span>
                                      <span>{member.rank || '(none)'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Patrol:</span>
                                      <span>{member.patrol || '(none)'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Position:</span>
                                      <span>{member.position || '(none)'}</span>
                                    </div>
                                    {member.position2 && (
                                      <div className="flex gap-1">
                                        <span className="font-medium text-stone-600 dark:text-stone-300">Position 2:</span>
                                        <span>{member.position2}</span>
                                      </div>
                                    )}
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Status:</span>
                                      <span>{member.renewalStatus || '(none)'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Expires:</span>
                                      <span>{member.expirationDate || '(none)'}</span>
                                    </div>
                                  </div>
                                )}
                                {member.changeType === 'update' && member.changes && (
                                  <div className="space-y-1">
                                    {Object.entries(member.changes).map(([field, change]) => {
                                      // Check if this field has a conflict
                                      const conflict = member.conflicts?.find((c) => c.field === field)
                                      const resolution = getEffectiveResolution(member, field)
                                      const isConflict = !!conflict
                                      const willUseChuckbox = isConflict && resolution === 'chuckbox'

                                      return (
                                        <div key={field} className={`flex items-start gap-1 ${isConflict ? 'bg-warning-light/50 rounded px-1 py-0.5 -mx-1' : ''}`}>
                                          <span className="font-medium text-stone-600 dark:text-stone-300 shrink-0">{field}:</span>
                                          {isConflict ? (
                                            // Conflict display with toggle
                                            <div className="flex flex-col gap-0.5">
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <span
                                                  className={`${
                                                    willUseChuckbox
                                                      ? 'text-stone-700 dark:text-stone-200 font-medium'
                                                      : 'text-stone-400 line-through'
                                                  }`}
                                                  title="Current Chuckbox value"
                                                >
                                                  {change.old || '(empty)'}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => handleFieldResolutionToggle(
                                                    member.id,
                                                    field,
                                                    resolution === 'chuckbox' ? 'scoutbook' : 'chuckbox'
                                                  )}
                                                  className="px-1 py-0.5 text-[10px] font-medium rounded bg-warning text-white hover:bg-warning-dark transition-colors"
                                                  title={`Click to use ${resolution === 'chuckbox' ? 'Scoutbook' : 'Chuckbox'} value`}
                                                >
                                                  {willUseChuckbox ? 'Keep' : 'Use'}
                                                </button>
                                                <span
                                                  className={`${
                                                    !willUseChuckbox
                                                      ? 'text-stone-700 dark:text-stone-200 font-medium'
                                                      : 'text-stone-400 line-through'
                                                  }`}
                                                  title="Scoutbook value"
                                                >
                                                  {change.new || '(empty)'}
                                                </span>
                                              </div>
                                              <span className="text-[10px] text-warning-dark">
                                                {conflict.reason === 'rank_downgrade' && '⚠️ Rank downgrade prevented'}
                                                {conflict.reason === 'null_overwrite' && '⚠️ Empty value blocked'}
                                              </span>
                                            </div>
                                          ) : (
                                            // Normal change display (no conflict)
                                            <>
                                              <span className="text-stone-400">{change.old || '(empty)'}</span>
                                              <span className="text-stone-400 dark:text-stone-500">&rarr;</span>
                                              <span className="text-stone-700 dark:text-stone-200">{change.new || '(empty)'}</span>
                                            </>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                                {member.changeType === 'update' && (!member.changes || Object.keys(member.changes).length === 0) && (
                                  <span className="text-stone-400">No field changes</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        {importableScouts.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-stone-500">
                              No scout changes to import
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Skipped Scouts Section */}
                  {stagingSummary.toSkip > 0 && (
                    <Collapsible className="mt-3">
                      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-stone-500 hover:text-stone-700">
                        <svg
                          className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-90"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        {stagingSummary.toSkip} scout{stagingSummary.toSkip !== 1 ? 's' : ''} unchanged (already up to date)
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 max-h-48 overflow-y-auto rounded border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
                          <table className="w-full text-xs">
                            <thead className="bg-stone-100 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Name</th>
                                <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">BSA ID</th>
                                <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stagedMembers
                                .filter((m) => (m.memberType === 'YOUTH' || m.memberType === 'P 18+') && m.changeType === 'skip')
                                .map((member) => (
                                  <tr key={member.id} className="border-t border-stone-200">
                                    <td className="p-2 text-stone-600">
                                      {member.firstName} {member.lastName}
                                    </td>
                                    <td className="p-2 text-stone-500 font-mono">
                                      {member.bsaMemberId}
                                    </td>
                                    <td className="p-2 text-stone-500">
                                      {member.skipReason === 'no_changes' ? 'No changes detected' : member.skipReason || 'Already exists'}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </TabsContent>

                {/* Adults Tab */}
                <TabsContent value="adults">
                  <div className="grid grid-cols-3 gap-4 text-center mb-4">
                    <div className="rounded-md bg-change-create-light p-3">
                      <p className="text-2xl font-bold text-change-create-foreground">
                        {stagingSummary.adultsToCreate || 0}
                      </p>
                      <p className="text-xs text-change-create-dark">New Adults</p>
                    </div>
                    <div className="rounded-md bg-change-update-light p-3">
                      <p className="text-2xl font-bold text-change-update-foreground">
                        {stagingSummary.adultsToUpdate || 0}
                      </p>
                      <p className="text-xs text-change-update-dark">Updates</p>
                    </div>
                    <div className="rounded-md bg-change-match-light p-3">
                      <p className="text-2xl font-bold text-change-match-foreground">
                        {selectedAdultIds.size}
                      </p>
                      <p className="text-xs text-change-match-dark">Selected</p>
                    </div>
                  </div>

                  {/* Select all/none controls */}
                  {importableAdults.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 text-xs">
                      <span className="text-stone-500">Select:</span>
                      <Button
                        type="button"
                        variant="link"
                        size="inline"
                        onClick={selectAllAdults}
                      >
                        All
                      </Button>
                      <span className="text-stone-300">|</span>
                      <Button
                        type="button"
                        variant="link"
                        size="inline"
                        onClick={selectNoAdults}
                      >
                        None
                      </Button>
                      <span className="ml-2 text-stone-400">
                        ({selectedAdultIds.size} of {importableAdults.length} selected)
                      </span>
                    </div>
                  )}

                  <div className="max-h-72 overflow-y-auto rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 dark:bg-stone-900 sticky top-0">
                        <tr>
                          <th className="w-8 p-2"></th>
                          <th className="text-left p-2 font-medium">Name</th>
                          <th className="text-left p-2 font-medium">Action</th>
                          <th className="text-left p-2 font-medium">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importableAdults.map((member) => (
                            <tr
                              key={member.id}
                              className={`border-t border-stone-100 dark:border-stone-700 ${
                                !selectedAdultIds.has(member.id) ? 'opacity-50' : ''
                              }`}
                            >
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  checked={selectedAdultIds.has(member.id)}
                                  onChange={() => toggleAdultSelection(member.id)}
                                  className="checkbox-native"
                                />
                              </td>
                              <td className="p-2">
                                <div>
                                  <span>{member.firstName} {member.lastName}</span>
                                  {member.matchedProfileId && (
                                    <span className="ml-1 inline-flex items-center rounded-full bg-change-match-light px-1.5 py-0.5 text-[10px] font-medium text-change-match-foreground">
                                      {member.matchType === 'bsa_id' ? 'BSA ID Match' : 'Name Match'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                {member.changeType === 'create' && (
                                  <span className="inline-flex items-center rounded-full bg-change-create-light px-2 py-0.5 text-xs font-medium text-change-create-foreground">
                                    Create
                                  </span>
                                )}
                                {member.changeType === 'update' && (
                                  <span className="inline-flex items-center rounded-full bg-change-update-light px-2 py-0.5 text-xs font-medium text-change-update-foreground">
                                    Update
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-xs text-stone-500">
                                {member.changeType === 'create' && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">BSA ID:</span>
                                      <span className="font-mono">{member.bsaMemberId}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Type:</span>
                                      <span>{member.memberType}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Position:</span>
                                      <span>{member.position || '(none)'}</span>
                                    </div>
                                    {member.position2 && (
                                      <div className="flex gap-1">
                                        <span className="font-medium text-stone-600 dark:text-stone-300">Position 2:</span>
                                        <span>{member.position2}</span>
                                      </div>
                                    )}
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Status:</span>
                                      <span>{member.renewalStatus || '(none)'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="font-medium text-stone-600 dark:text-stone-300">Expires:</span>
                                      <span>{member.expirationDate || '(none)'}</span>
                                    </div>
                                  </div>
                                )}
                                {member.changeType === 'update' && member.changes && (
                                  <div className="space-y-0.5">
                                    {Object.entries(member.changes).map(([field, change]) => (
                                      <div key={field} className="flex gap-1">
                                        <span className="font-medium text-stone-600 dark:text-stone-300">{field}:</span>
                                        <span className="text-stone-400">{change.old || '(empty)'}</span>
                                        <span className="text-stone-400 dark:text-stone-500">&rarr;</span>
                                        <span className="text-stone-700 dark:text-stone-200">{change.new || '(empty)'}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {member.changeType === 'update' && (!member.changes || Object.keys(member.changes).length === 0) && (
                                  <span className="text-stone-400">No field changes</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        {importableAdults.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-stone-500">
                              No adult changes to import
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Skipped Adults Section */}
                  {(() => {
                    const skippedAdults = stagedMembers.filter((m) => m.memberType === 'LEADER' && m.changeType === 'skip')
                    if (skippedAdults.length === 0) return null
                    return (
                      <Collapsible className="mt-3">
                        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-stone-500 hover:text-stone-700">
                          <svg
                            className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-90"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                          {skippedAdults.length} adult{skippedAdults.length !== 1 ? 's' : ''} unchanged (already up to date)
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 max-h-48 overflow-y-auto rounded border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
                            <table className="w-full text-xs">
                              <thead className="bg-stone-100 sticky top-0">
                                <tr>
                                  <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Name</th>
                                  <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Type</th>
                                  <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {skippedAdults.map((member) => (
                                  <tr key={member.id} className="border-t border-stone-200">
                                    <td className="p-2 text-stone-600">
                                      {member.firstName} {member.lastName}
                                    </td>
                                    <td className="p-2 text-stone-500">
                                      {member.memberType === 'LEADER' ? 'Leader' : 'Parent'}
                                    </td>
                                    <td className="p-2 text-stone-500">
                                      {member.skipReason === 'no_changes' ? 'No changes detected' : member.skipReason || 'Already exists'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })()}

                  <p className="mt-2 text-xs text-stone-500">
                    Adults will be added to the roster but not invited as app users.
                    You can invite them later from the roster page.
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            {/* Confirm/Cancel Buttons */}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={handleCancelSync}
                disabled={isCancelling || isConfirming}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel'}
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={isConfirming || isCancelling || (
                  stagingSummary.toCreate === 0 &&
                  stagingSummary.toUpdate === 0 &&
                  (stagingSummary.adultsToCreate || 0) === 0 &&
                  (stagingSummary.adultsToUpdate || 0) === 0
                )}
              >
                {isConfirming ? 'Importing...' : `Confirm Import`}
              </Button>
            </div>
          </div>
        )}

        {/* Last Sync Info */}
        {!hasStaging && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-stone-500">Last Synced</p>
              <p>{formatDate(lastSyncAt)}</p>
            </div>
            <div>
              <p className="text-stone-500">Members Synced</p>
              <p>{lastSyncMemberCount ?? 'N/A'}</p>
            </div>
          </div>
        )}

        {/* Sync History */}
        {!hasStaging && syncHistory.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowSyncHistory(!showSyncHistory)}
              className="flex items-center gap-2 text-xs text-stone-500 hover:text-stone-700"
            >
              <svg
                className={`h-4 w-4 transition-transform ${showSyncHistory ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              Sync History ({syncHistory.length} recent syncs)
            </button>
            {showSyncHistory && (
              <div className="mt-2 rounded-md border border-stone-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 dark:bg-stone-900">
                    <tr>
                      <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Date</th>
                      <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Source</th>
                      <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Members</th>
                      <th className="text-left p-2 font-medium text-stone-600 dark:text-stone-300">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncHistory.map((sync) => (
                      <tr key={sync.id} className="border-t border-stone-100 dark:border-stone-700">
                        <td className="p-2 text-stone-600">
                          {sync.completedAt ? formatDate(sync.completedAt) : formatDate(sync.startedAt)}
                        </td>
                        <td className="p-2 text-stone-600 capitalize">
                          {sync.syncSource || 'Unknown'}
                        </td>
                        <td className="p-2 text-stone-600">
                          {sync.recordsExtracted ?? '-'}
                        </td>
                        <td className="p-2">
                          {sync.status === 'completed' ? (
                            <span className="inline-flex items-center rounded-full bg-success-light px-1.5 py-0.5 text-[10px] font-medium text-success">
                              Completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-error-light px-1.5 py-0.5 text-[10px] font-medium text-error">
                              Failed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize text-stone-600">{progress.phase}</span>
              <span className="text-stone-500">{progress.percentComplete}%</span>
            </div>
            <Progress value={progress.percentComplete} className="h-2" />
            <p className="text-sm text-stone-500">{progress.message}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md bg-error-light p-3 text-sm text-error">
            <p className="font-medium">Error</p>
            <p className="whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`rounded-md p-3 text-sm ${
              result.success
                ? 'bg-success-light text-success'
                : 'bg-warning-light text-warning'
            }`}
          >
            <p className="font-medium">
              {result.success ? 'Import Complete' : 'Import Completed with Errors'}
            </p>
            <p>
              <strong>Scouts:</strong> {result.created} created, {result.updated} updated
              {result.skipped > 0 && `, ${result.skipped} skipped`}
            </p>
            {(result.adultsCreated > 0 || result.adultsUpdated > 0) && (
              <p>
                <strong>Adults:</strong> {result.adultsCreated} created, {result.adultsUpdated} updated
                {result.adultsLinked > 0 && `, ${result.adultsLinked} linked to profiles`}
              </p>
            )}
            {result.errors > 0 && (
              <p className="text-warning">
                {result.errors} error{result.errors !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* CLI Sync Button - only when CLI automation is enabled */}
        {showCliAutomation && !hasStaging && !isServerless && isAdmin ? (
          <div className="flex gap-2">
            <Button
              onClick={handleSync}
              disabled={isSyncing || !isCliReady}
            >
              {isSyncing ? 'Syncing...' : 'Sync from Scoutbook'}
            </Button>
          </div>
        ) : showCliAutomation && !hasStaging && !isServerless && !isAdmin ? (
          <p className="text-sm text-stone-500">
            Only unit administrators can sync from Scoutbook.
          </p>
        ) : null}

        {/* Requirements Info - only when CLI automation is enabled */}
        {showCliAutomation && !hasStaging && !isServerless && (
          <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs text-stone-500">
            <p className="font-medium text-stone-600 dark:text-stone-300">How it works:</p>
            <ol className="mt-1 list-inside list-decimal space-y-1">
              <li>A browser window opens to Scoutbook Plus</li>
              <li>You log in with your BSA credentials (we never see them)</li>
              <li>Chuckbox extracts roster data for your review</li>
              <li>You confirm which scouts to create or update</li>
            </ol>
          </div>
        )}

        {/* Roster Sync Section */}
        {isAdmin && !hasStaging && (
          <div className={showCliAutomation && !isServerless ? 'mt-6 border-t border-stone-200 pt-4' : ''}>
            <h3 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              Roster Sync
            </h3>
            <p className="text-xs text-stone-500 mb-3">
              Choose how to sync your unit roster from Scoutbook
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Browser Extension Option */}
              <div className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-warning-light shrink-0">
                    <svg className="h-4 w-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Browser Extension</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Sync while browsing Scoutbook
                    </p>
                    {extensionToken ? (
                      <div className="mt-3 space-y-2">
                        <div className="rounded-md bg-success-light p-2">
                          <p className="text-xs font-medium text-success">Token Generated - Copy Now</p>
                          <p className="text-xs text-success/80">
                            Expires {tokenExpiresAt && new Date(tokenExpiresAt).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="flex-1 rounded bg-white px-2 py-1 text-xs font-mono text-stone-700 truncate">
                              {extensionToken}
                            </code>
                            <Button size="sm" variant="outline" onClick={handleCopyToken} className="shrink-0 h-7 text-xs">
                              {tokenCopied ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => { setExtensionToken(null); setTokenExpiresAt(null) }} className="h-7 text-xs">
                          Done
                        </Button>
                      </div>
                    ) : activeTokens.length > 0 ? (
                      // Show active token status with Sync Now button
                      <div className="mt-3 space-y-2">
                        <div className="rounded-md bg-success-light/50 border border-success/20 p-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-success">Extension Connected</p>
                              <p className="text-xs text-success/70">
                                {activeTokens[0].lastUsedAt ? (
                                  <>Last used: {new Date(activeTokens[0].lastUsedAt).toLocaleDateString('en-US', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                  })}</>
                                ) : (
                                  <>Token created, not yet used</>
                                )}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              onClick={() => window.open('https://advancements.scouting.org/myroster', '_blank')}
                            >
                              Sync Now
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" disabled={isGeneratingToken} className="h-7 text-xs">
                                {isGeneratingToken ? 'Generating...' : 'New Token'}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Generate New Token</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                  <div className="space-y-3 text-left">
                                    <p>This will revoke your current token and create a new one.</p>
                                    <div className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs">
                                      <p className="font-medium text-warning-dark">Warning</p>
                                      <p className="mt-1 text-warning-dark">
                                        You will need to update the token in your browser extension after generating a new one.
                                      </p>
                                    </div>
                                  </div>
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleGenerateToken}>Generate New Token</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" disabled={isGeneratingToken} className="h-7 text-xs">
                              {isGeneratingToken ? 'Generating...' : 'Generate Token'}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Generate Extension Token</AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-3 text-left">
                                  <p>This will create a secure token for the Chuckbox browser extension.</p>
                                  <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs">
                                    <p className="font-medium text-stone-700 dark:text-stone-200">Token Details:</p>
                                    <ul className="mt-1 list-inside list-disc space-y-1 text-stone-600">
                                      <li>Expires in 60 days</li>
                                      <li>Can be revoked at any time</li>
                                      <li>Only shown once - copy it immediately</li>
                                    </ul>
                                  </div>
                                  <div className="rounded-md border border-warning/30 bg-warning-light p-3 text-xs">
                                    <p className="font-medium text-warning-dark">Security Note</p>
                                    <p className="mt-1 text-warning-dark">
                                      Anyone with this token can sync your roster. Keep it secure.
                                    </p>
                                  </div>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleGenerateToken}>Generate Token</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          variant="link"
                          size="inline"
                          asChild
                          className="text-xs"
                        >
                          <a
                            href="https://chrome.google.com/webstore/category/extensions"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Get Extension
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* CSV Upload Option */}
              <div className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-forest-100 shrink-0">
                    <svg className="h-4 w-4 text-forest-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200">CSV Upload</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Export from my.scouting.org and upload
                    </p>
                    <div className="mt-2">
                      <Link href="/settings/import">
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          Upload CSV
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Advancement Import Section */}
        {!hasStaging && (
          <div className="mt-6 border-t border-stone-200 pt-4">
            <h3 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-1">
              Advancement Import
            </h3>
            <p className="text-xs text-stone-500 mb-3">
              Import advancement history from Scoutbook exports
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Single Scout Import */}
              <div className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100 shrink-0">
                    <svg className="h-4 w-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Single Scout</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Import one scout&apos;s advancement history
                    </p>
                    <div className="mt-2">
                      <Link href="/settings/import/advancement">
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          Import
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {/* Entire Unit Import */}
              <div className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-100 shrink-0">
                    <svg className="h-4 w-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Entire Unit</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Bulk import for all scouts at once
                    </p>
                    <div className="mt-2">
                      <Link href="/settings/import/troop-advancement">
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          Import
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
