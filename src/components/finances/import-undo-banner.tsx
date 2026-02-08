'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CheckCircle2, X } from 'lucide-react'

interface ImportUndoBannerProps {
  batchId: string
  importedAt: string // ISO date string
  rowCount: number
}

export function ImportUndoBanner({
  batchId,
  importedAt,
  rowCount,
}: ImportUndoBannerProps) {
  const router = useRouter()
  const [isDismissed, setIsDismissed] = useState(false)
  const [isUndoing, setIsUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isDismissed) {
    return null
  }

  const timeAgo = formatDistanceToNow(new Date(importedAt), { addSuffix: true })

  async function handleUndo() {
    setIsUndoing(true)
    setError(null)

    try {
      const response = await fetch(`/api/import/balances/${batchId}/undo`, {
        method: 'POST',
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        setError(result.error || 'Failed to undo import')
        setIsUndoing(false)
        return
      }

      // Refresh the page to show updated balances
      router.refresh()
    } catch {
      setError('Failed to undo import. Please try again.')
      setIsUndoing(false)
    }
  }

  return (
    <Alert variant="success" showIcon className="relative">
      <CheckCircle2 className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          Imported {rowCount} balance{rowCount !== 1 ? 's' : ''} {timeAgo}.
          {error && (
            <span className="ml-2 text-error-dark font-medium">{error}</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={isUndoing}
            loading={isUndoing}
            loadingText="Undoing..."
          >
            Undo
          </Button>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="rounded-md p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
