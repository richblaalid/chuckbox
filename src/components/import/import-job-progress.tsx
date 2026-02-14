'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { getImportJobStatus, type ImportJob } from '@/app/actions/import-jobs'
import type { TroopAdvancementImportResult } from '@/lib/import/troop-advancement-types'

interface ImportJobProgressProps {
  jobId: string
  onComplete: (result: TroopAdvancementImportResult) => void
  onError: (error: string) => void
  onCancel?: () => void
}

export function ImportJobProgress({
  jobId,
  onComplete,
  onError,
  onCancel,
}: ImportJobProgressProps) {
  const [job, setJob] = useState<ImportJob | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)

  const pollStatus = useCallback(async () => {
    const result = await getImportJobStatus(jobId)

    if (!result.success) {
      setPollError(result.error || 'Failed to get job status')
      return null
    }

    return result.data
  }, [jobId])

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null
    let mounted = true

    const checkStatus = async () => {
      const jobData = await pollStatus()

      if (!mounted) return

      if (jobData) {
        setJob(jobData)

        if (jobData.status === 'completed' && jobData.result) {
          if (intervalId) clearInterval(intervalId)
          onComplete(jobData.result)
        } else if (jobData.status === 'failed') {
          if (intervalId) clearInterval(intervalId)
          onError(jobData.error_message || 'Import failed')
        }
      }
    }

    // Initial check
    checkStatus()

    // Poll every second for responsive updates
    intervalId = setInterval(checkStatus, 1000)

    return () => {
      mounted = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [jobId, pollStatus, onComplete, onError])

  const progress = job
    ? Math.round((job.processed_items / Math.max(job.total_items, 1)) * 100)
    : 0

  const phaseLabels: Record<string, string> = {
    loading_reference_data: 'Loading reference data...',
    scouts: 'Creating scout records...',
    ranks: 'Processing ranks...',
    badges: 'Processing merit badges...',
    rank_requirements: 'Processing rank requirements...',
    badge_requirements: 'Processing badge requirements...',
  }

  const currentPhaseLabel = job?.current_phase
    ? phaseLabels[job.current_phase] || job.current_phase
    : 'Starting import...'

  if (pollError) {
    return (
      <Card className="border-warning">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Connection Issue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-stone-600">
            Unable to check import status: {pollError}
          </p>
          <p className="text-sm text-stone-500">
            The import may still be processing in the background. Try refreshing the page.
          </p>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Go Back
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {job?.status === 'processing' ? (
            <Loader2 className="h-5 w-5 animate-spin text-forest-600" />
          ) : job?.status === 'completed' ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : job?.status === 'failed' ? (
            <XCircle className="h-5 w-5 text-error" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
          )}
          {job?.status === 'completed'
            ? 'Import Complete'
            : job?.status === 'failed'
            ? 'Import Failed'
            : 'Importing Advancement Data'}
        </CardTitle>
        <CardDescription>
          {job?.status === 'completed'
            ? 'All records have been processed successfully'
            : job?.status === 'failed'
            ? job.error_message || 'An error occurred during import'
            : currentPhaseLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-stone-600">Progress</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-stone-50 p-4">
            <p className="text-sm text-stone-500">Scouts</p>
            <p className="text-2xl font-semibold">
              {job?.processed_scouts || 0}{' '}
              <span className="text-sm font-normal text-stone-400">
                / {job?.total_scouts || 0}
              </span>
            </p>
          </div>
          <div className="rounded-lg bg-stone-50 p-4">
            <p className="text-sm text-stone-500">Items</p>
            <p className="text-2xl font-semibold">
              {job?.processed_items || 0}{' '}
              <span className="text-sm font-normal text-stone-400">
                / {job?.total_items || 0}
              </span>
            </p>
          </div>
        </div>

        {job?.status === 'processing' && (
          <p className="text-center text-sm text-stone-500">
            Please keep this page open until the import completes.
            <br />
            Large imports may take several minutes.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
