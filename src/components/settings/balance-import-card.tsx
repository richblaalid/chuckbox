'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { DollarSign, Upload, Undo2, Loader2, CheckCircle, XCircle } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

interface BalanceImportBatch {
  id: string
  created_at: string
  mode: 'set' | 'adjust'
  row_count: number
  status: 'active' | 'reversed'
  imported_by_profile: {
    full_name: string | null
    email: string | null
  } | null
}

interface BalanceImportCardProps {
  batches?: BalanceImportBatch[]
  canUndoLatest?: boolean
}

export function BalanceImportCard({
  batches = [],
  canUndoLatest = false,
}: BalanceImportCardProps) {
  const router = useRouter()
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const latestActiveBatch = batches.find((b) => b.status === 'active')

  const handleUndo = async (batchId: string) => {
    setUndoingId(batchId)
    setError(null)

    try {
      const response = await fetch(`/api/import/balances/${batchId}/undo`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to undo import')
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo import')
    } finally {
      setUndoingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle>Account Balances</CardTitle>
              <CardDescription>
                Import scout account balances from a CSV file
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-stone-600">
          Import starting balances for scout accounts from your existing
          financial records. This is useful when migrating from another system
          or setting up your unit for the first time.
        </p>

        <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs text-stone-500">
          <p className="font-medium text-stone-600 dark:text-stone-300">
            What you can import:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Billing balances (amounts owed to the unit)</li>
            <li>Fund balances (scout savings/credits)</li>
            <li>Match scouts by name or BSA Member ID</li>
          </ul>
        </div>

        <Link href="/settings/import/balances">
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Import Balances
          </Button>
        </Link>

        {/* Import History Section */}
        {batches.length > 0 && (
          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium text-stone-900 mb-3">Import History</h4>

            {error && (
              <div className="rounded-md bg-error-light border border-error p-3 text-sm text-error mb-3">
                {error}
              </div>
            )}

            <div className="divide-y divide-stone-100">
              {batches.map((batch) => {
                const isLatestActive =
                  batch.status === 'active' && batch.id === latestActiveBatch?.id
                const canUndo = isLatestActive && canUndoLatest
                const isUndoing = undoingId === batch.id

                return (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3">
                      {batch.status === 'active' ? (
                        <CheckCircle className="mt-0.5 h-5 w-5 text-success" />
                      ) : (
                        <XCircle className="mt-0.5 h-5 w-5 text-stone-400" />
                      )}
                      <div>
                        <p className="font-medium text-stone-900">
                          {batch.row_count} account{batch.row_count !== 1 ? 's' : ''}{' '}
                          {batch.mode === 'set' ? 'set' : 'adjusted'}
                          {batch.status === 'reversed' && (
                            <span className="ml-2 text-sm text-stone-500">
                              (reversed)
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-stone-500">
                          {formatDistanceToNow(new Date(batch.created_at), {
                            addSuffix: true,
                          })}
                          {batch.imported_by_profile && (
                            <>
                              {' by '}
                              {batch.imported_by_profile.full_name ||
                                batch.imported_by_profile.email ||
                                'Unknown'}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {canUndo && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isUndoing}
                            className="gap-1"
                          >
                            {isUndoing ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Undoing...
                              </>
                            ) : (
                              <>
                                <Undo2 className="h-4 w-4" />
                                Undo
                              </>
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Undo Balance Import?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will reverse all {batch.row_count} balance changes
                              from this import by creating offsetting journal entries.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleUndo(batch.id)}
                              className="bg-error hover:bg-error/90"
                            >
                              Undo Import
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    {isLatestActive && !canUndoLatest && (
                      <span className="text-xs text-stone-400">
                        Cannot undo (subsequent activity)
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
