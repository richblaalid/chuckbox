import { withSentryConfig } from '@sentry/nextjs'
import { execFileSync } from 'node:child_process'

// Release identifier for Sentry events: Vercel provides the commit SHA in
// deployed environments; fall back to the local git HEAD for dev servers.
function resolveRelease() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: resolveRelease(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async redirects() {
    return [
      // Financial IA consolidation - redirect old routes to new /finances structure
      {
        source: '/accounts',
        destination: '/finances/accounts',
        permanent: true,
      },
      {
        source: '/accounts/:id',
        destination: '/finances/accounts/:id',
        permanent: true,
      },
      {
        source: '/billing',
        destination: '/finances/billing',
        permanent: true,
      },
      {
        source: '/payments',
        destination: '/finances/payments',
        permanent: true,
      },
      {
        source: '/reports',
        destination: '/finances/reports',
        permanent: true,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        // Allow CORS for extension auth API
        source: '/api/scoutbook/extension-auth',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        // Allow CORS for extension sync API
        source: '/api/scoutbook/extension-sync',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Source-map upload is deferred until SENTRY_AUTH_TOKEN/org/project are
  // configured in the Vercel environment — builds stay green without them.
  silent: true,
  disableLogger: true,
})
