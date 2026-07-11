'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    if (process.env.NODE_ENV === 'development') {
      console.error('Dashboard error:', error)
    }
  }, [error])

  return (
    <div className="flex min-h-[400px] items-center justify-center p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            An error occurred while loading this page. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            If this problem persists, please contact support with error code:{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs">
              {error.digest || 'unknown'}
            </code>
          </p>
          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => window.location.href = '/dashboard'}>
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
