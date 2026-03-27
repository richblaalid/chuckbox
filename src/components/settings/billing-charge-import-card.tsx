'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Receipt, Upload, Undo2, Loader2, CheckCircle, Send } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'

interface BillingImportBatch {
  id: string
  created_at: string
  total_records: number
  total_amount: number
  notifications_sent: boolean | null
  created_by_profile: {
    full_name: string | null
    email: string | null
  } | null
}

interface BillingChargeImportCardProps {
  batches?: BillingImportBatch[]
}

export function BillingChargeImportCard({
  batches = [],
}: BillingChargeImportCardProps) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleVoid = async (batchId: string) => {
    setVoidingId(batchId)
    setError(null)

    try {
      const response = await fetch(`/api/import/charges/${batchId}/void`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to void charges')
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void charges')
    } finally {
      setVoidingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600">
              <Receipt className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle>Billing Charges</CardTitle>
              <CardDescription>
                Import billing charges from a CSV file
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-stone-600">
          Upload a spreadsheet of charges to bill scouts for events, camps,
          equipment, or other expenses. Each row creates a billing record
          with proper accounting entries.
        </p>

        <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs text-stone-500">
          <p className="font-medium text-stone-600 dark:text-stone-300">
            What you can import:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Per-scout charge amounts (variable or uniform)</li>
            <li>Description, date, reference, and memo per charge</li>
            <li>Match scouts by BSA Member ID or name</li>
            <li>Send payment link emails to families after import</li>
          </ul>
        </div>

        <Link href="/settings/import/charges">
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Import Charges
          </Button>
        </Link>

        {/* Import History */}
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
                const isVoiding = voidingId === batch.id

                return (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3">
                      <CheckCircle className="mt-0.5 h-5 w-5 text-success" />
                      <div>
                        <p className="font-medium text-stone-900">
                          {batch.total_records} charge{batch.total_records !== 1 ? 's' : ''} · {formatCurrency(batch.total_amount)}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm text-stone-500">
                            {formatDistanceToNow(new Date(batch.created_at), {
                              addSuffix: true,
                            })}
                            {batch.created_by_profile && (
                              <>
                                {' by '}
                                {batch.created_by_profile.full_name ||
                                  batch.created_by_profile.email ||
                                  'Unknown'}
                              </>
                            )}
                          </p>
                          {batch.notifications_sent ? (
                            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs px-1.5 py-0">
                              <Send className="mr-1 h-3 w-3" />
                              Notified
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-stone-200 text-stone-500 text-xs px-1.5 py-0">
                              Not notified
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isVoiding}
                          className="gap-1"
                        >
                          {isVoiding ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Voiding...
                            </>
                          ) : (
                            <>
                              <Undo2 className="h-4 w-4" />
                              Void
                            </>
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Void All Charges in This Import?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will void all {batch.total_records} billing charges
                            ({formatCurrency(batch.total_amount)}) from this import and create
                            reversal journal entries. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleVoid(batch.id)}
                            className="bg-error hover:bg-error/90"
                          >
                            Void Charges
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
