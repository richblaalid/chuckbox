import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

// Real-DB integration suite (PLATFORM-009). Runs ONLY tests/integration/
// against the shared dev Supabase project via `npm run test:integration`.
// Kept out of the default config so `make test` stays hermetic — the
// service-role key in .env.local must never be picked up by the unit run.
//
// No jsdom and no tests/setup.ts here: that setup file is DOM-coupled
// (RTL cleanup, scrollIntoView polyfill) and stubs Supabase env vars,
// while these tests need real credentials and plain node. Each suite
// still skips itself when credentials are absent (see tests/integration/setup.ts).
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.{test,spec}.ts'],
    // Real network round-trips to Supabase — default 5s is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: loadEnv(mode, process.cwd(), ''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
