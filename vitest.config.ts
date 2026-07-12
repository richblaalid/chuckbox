import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env files so unit tests see the same vars as the app; the real-DB
  // suite is excluded below, so nothing here reaches the shared dev database.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      globals: true,
      include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      // tests/integration is the real-DB suite — run it explicitly via
      // `npm run test:integration` (vitest.integration.config.ts). Excluding
      // it here keeps `make test` hermetic even when .env.local exists.
      exclude: ['node_modules', '.next', 'dist', '.worktrees', 'tests/e2e', 'tests/integration'],
      // Make env vars available to tests
      env,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'tests/setup.ts',
          '**/*.d.ts',
          '**/*.config.*',
          '**/types/**',
        ],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
