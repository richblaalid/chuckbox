import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Error monitoring only — no performance tracing for the pilot
  tracesSampleRate: 0,

  // Forward events to a local Spotlight sidecar in dev (no DSN required)
  spotlight: process.env.NODE_ENV === 'development',
})
