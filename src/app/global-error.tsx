'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    if (process.env.NODE_ENV === 'development') {
      console.error('Global error:', error)
    }
  }, [error])

  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{
            maxWidth: '400px',
            textAlign: 'center',
          }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              marginBottom: '8px',
              color: '#1c1917',
            }}>
              Something went wrong
            </h2>
            <p style={{
              fontSize: '14px',
              color: '#57534e',
              marginBottom: '24px',
            }}>
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {error.digest && (
              <p style={{
                fontSize: '12px',
                color: '#a8a29e',
                marginBottom: '16px',
                fontFamily: 'monospace',
              }}>
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                backgroundColor: '#16a34a',
                color: 'white',
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
