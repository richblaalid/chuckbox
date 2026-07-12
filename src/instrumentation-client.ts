import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: 0,

  integrations:
    process.env.NODE_ENV === 'development'
      ? [Sentry.spotlightBrowserIntegration()]
      : [],
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
