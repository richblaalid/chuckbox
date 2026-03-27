'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle, AlertCircle, Send, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

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

interface ChargeImportCompleteProps {
  result: ImportResult
  onStartOver: () => void
  onDone: () => void
}

export function ChargeImportComplete({ result, onStartOver, onDone }: ChargeImportCompleteProps) {
  const [isSending, setIsSending] = useState(false)
  const [notifyResult, setNotifyResult] = useState<{
    sent: number
    errors: string[]
  } | null>(null)
  const [notifyError, setNotifyError] = useState<string | null>(null)

  const handleSendBills = async () => {
    setIsSending(true)
    setNotifyError(null)

    try {
      const response = await fetch(`/api/import/charges/${result.batchId}/notify`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to send notifications')
      }

      const data = await response.json()
      setNotifyResult({
        sent: data.notificationsSent,
        errors: data.errors || [],
      })
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : 'Failed to send notifications')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle
            className={`flex items-center gap-2 ${
              result.errors.length > 0 ? 'text-warning' : 'text-green-600'
            }`}
          >
            {result.errors.length > 0 ? (
              <AlertCircle className="h-6 w-6" />
            ) : (
              <CheckCircle className="h-6 w-6" />
            )}
            {result.errors.length > 0 ? 'Import Completed with Errors' : 'Import Complete'}
          </CardTitle>
          <CardDescription>
            {result.errors.length > 0
              ? 'Some charges could not be imported'
              : 'Billing charges have been created successfully'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-stone-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{result.imported}</p>
              <p className="text-sm text-stone-500">Charges Created</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-4 text-center">
              <p className="text-2xl font-bold text-forest-700">{formatCurrency(result.totalAmount)}</p>
              <p className="text-sm text-stone-500">Total Billed</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-4 text-center">
              <p className="text-2xl font-bold text-stone-600">{result.skipped}</p>
              <p className="text-sm text-stone-500">Skipped</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
              <p className="text-sm text-stone-500">Errors</p>
            </div>
          </div>

          {/* Error List */}
          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
              <ul className="space-y-1 text-sm text-red-700">
                {result.errors.map((err, i) => (
                  <li key={i}>
                    <span className="font-medium">{err.scoutName}:</span> {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Send Bills Section */}
          {result.imported > 0 && !notifyResult && (
            <div className="rounded-lg border border-forest-200 bg-forest-50 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-forest-900">Send Bills to Families</h4>
                  <p className="mt-1 text-sm text-forest-700">
                    Send payment link emails to each scout&apos;s primary guardian. They can pay
                    online via Square, use scout funds, or pay by cash/check.
                  </p>
                </div>
                <Button
                  onClick={handleSendBills}
                  disabled={isSending}
                  className="shrink-0"
                >
                  {isSending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {isSending ? 'Sending...' : 'Send Bills'}
                </Button>
              </div>
            </div>
          )}

          {/* Notification Error */}
          {notifyError && (
            <Alert variant="error">
              <AlertTitle>Notification Error</AlertTitle>
              <AlertDescription>{notifyError}</AlertDescription>
            </Alert>
          )}

          {/* Notification Result */}
          {notifyResult && (
            <Alert variant={notifyResult.errors.length > 0 ? 'warning' : 'success'}>
              <AlertTitle>
                {notifyResult.errors.length > 0
                  ? 'Notifications Sent with Issues'
                  : 'Notifications Sent'}
              </AlertTitle>
              <AlertDescription>
                <p>{notifyResult.sent} payment link email{notifyResult.sent !== 1 ? 's' : ''} sent to families.</p>
                {notifyResult.errors.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-sm">
                    {notifyResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-center gap-4">
        <Button variant="outline" onClick={onStartOver}>
          Import Another File
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
