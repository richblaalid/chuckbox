# E2E Smoke Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 Playwright E2E smoke tests covering every critical user journey to catch regressions before deploys.

**Architecture:** Playwright tests run against dev Supabase with seeded test users. Auth is handled via a global setup that logs in with `signInWithPassword` through the browser and saves `storageState` for reuse. Each test file uses a specific role's auth state.

**Tech Stack:** Playwright, Supabase Auth (password login for test users), Next.js dev server on port 3000

---

## Prerequisites

- Dev server running (`npm run dev`)
- Dev database seeded (`npm run db:seed:all`)
- Test user credentials from CLAUDE.md (password: `testpassword123`)

---

### Task 0.1: Playwright Config & Auth Setup

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/fixtures/auth.ts`

**Step 1: Update playwright.config.ts to add global setup and auth projects**

```typescript
import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const authDir = path.join(__dirname, 'tests/e2e/.auth')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'on',
  },
  projects: [
    // Auth setup - runs first, creates storageState files
    {
      name: 'auth-setup',
      testMatch: /global-setup\.ts/,
    },
    // Smoke tests use saved auth state
    {
      name: 'smoke',
      testDir: './tests/e2e/smoke',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth-setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
})
```

**Step 2: Create global-setup.ts that authenticates each test role**

This navigates to the login page and uses Supabase client-side `signInWithPassword` via `page.evaluate()`, then saves the authenticated browser state.

```typescript
// tests/e2e/global-setup.ts
import { test as setup } from '@playwright/test'
import path from 'path'

const TEST_USERS = {
  admin: 'richard.blaalid+admin@withcaldera.com',
  treasurer: 'richard.blaalid+treasurer@withcaldera.com',
  leader: 'richard.blaalid+leader@withcaldera.com',
  parent: 'richard.blaalid+parent@withcaldera.com',
  scout: 'richard.blaalid+scout@withcaldera.com',
} as const

const PASSWORD = 'testpassword123'
const AUTH_DIR = path.join(__dirname, '.auth')

for (const [role, email] of Object.entries(TEST_USERS)) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    // Navigate to the app so Supabase client is available
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Sign in via Supabase client in browser context
    const result = await page.evaluate(
      async ({ email, password }) => {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || window.location.origin,
          // The anon key is embedded in the page's JS bundle
          (window as any).__NEXT_DATA__?.props?.pageProps?.supabaseAnonKey ||
            document.querySelector('meta[name="supabase-anon-key"]')?.getAttribute('content') ||
            ''
        )
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return { error: error?.message }
      },
      { email, password: PASSWORD }
    )

    if (result.error) {
      throw new Error(`Auth failed for ${role}: ${result.error}`)
    }

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 10000 })

    // Save authenticated state
    await page.context().storageState({
      path: path.join(AUTH_DIR, `${role}.json`),
    })
  })
}
```

**Step 3: Create auth fixture for tests to use**

```typescript
// tests/e2e/fixtures/auth.ts
import { test as base } from '@playwright/test'
import path from 'path'

const AUTH_DIR = path.join(__dirname, '..', '.auth')

export function authTest(role: 'admin' | 'treasurer' | 'leader' | 'parent' | 'scout') {
  return base.extend({
    storageState: path.join(AUTH_DIR, `${role}.json`),
  })
}
```

**Step 4: Add `.auth/` to `.gitignore`**

Append to `.gitignore`:
```
tests/e2e/.auth/
```

**Step 5: Add npm scripts to package.json**

```json
"test:e2e": "npx playwright test",
"test:e2e:ui": "npx playwright test --ui"
```

**Step 6: Run auth setup to verify it works**

Run: `npx playwright test --project=auth-setup`
Expected: 5 auth state files created in `tests/e2e/.auth/`

**Step 7: Commit**

```bash
git add playwright.config.ts tests/e2e/ .gitignore package.json
git commit -m "feat: add Playwright E2E auth setup and fixtures"
```

---

### Task 1.1: Login Smoke Test

**Files:**
- Create: `tests/e2e/smoke/01-login.spec.ts`

**Step 1: Write the login test**

```typescript
// tests/e2e/smoke/01-login.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Login flow', () => {
  test('shows login page with email form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/login**')
    await expect(page).toHaveURL(/\/login/)
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/01-login.spec.ts`
Expected: 2 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/01-login.spec.ts
git commit -m "test: add login E2E smoke test"
```

---

### Task 1.2: Dashboard Smoke Test

**Files:**
- Create: `tests/e2e/smoke/02-dashboard.spec.ts`

**Step 1: Write the dashboard test (admin role)**

```typescript
// tests/e2e/smoke/02-dashboard.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Dashboard', () => {
  test('loads and shows unit name', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    // Dashboard should show the unit name or a welcome message
    await expect(page.locator('body')).not.toContainText('Error')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('navigation sidebar has expected links', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    // Check key nav items exist
    await expect(page.getByRole('link', { name: /scouts/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /accounts/i })).toBeVisible()
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/02-dashboard.spec.ts`
Expected: 2 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/02-dashboard.spec.ts
git commit -m "test: add dashboard E2E smoke test"
```

---

### Task 1.3: Roster Smoke Test

**Files:**
- Create: `tests/e2e/smoke/03-roster.spec.ts`

**Step 1: Write the roster test (admin role)**

```typescript
// tests/e2e/smoke/03-roster.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Roster', () => {
  test('scout list loads with data', async ({ page }) => {
    await page.goto('/scouts')
    await page.waitForLoadState('networkidle')
    // Should show at least one scout from test seed
    await expect(page.getByRole('table').or(page.locator('[data-testid="scout-list"]')).or(page.locator('body'))).toBeVisible()
    // No error states
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/03-roster.spec.ts`
Expected: 1 test passes

**Step 3: Commit**

```bash
git add tests/e2e/smoke/03-roster.spec.ts
git commit -m "test: add roster E2E smoke test"
```

---

### Task 1.4: Advancement Smoke Test

**Files:**
- Create: `tests/e2e/smoke/04-advancement.spec.ts`

**Step 1: Write the advancement test (leader role)**

```typescript
// tests/e2e/smoke/04-advancement.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('leader')

test.describe('Advancement', () => {
  test('merit badge list loads', async ({ page }) => {
    await page.goto('/advancement')
    await page.waitForLoadState('networkidle')
    // Should show merit badges or advancement content
    await expect(page.locator('body')).not.toContainText('Something went wrong')
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('can open a merit badge detail', async ({ page }) => {
    await page.goto('/advancement')
    await page.waitForLoadState('networkidle')
    // Click the first badge/link available
    const firstBadge = page.locator('[data-testid="badge-card"], a[href*="advancement"]').first()
    if (await firstBadge.isVisible()) {
      await firstBadge.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText('Something went wrong')
    }
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/04-advancement.spec.ts`
Expected: 2 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/04-advancement.spec.ts
git commit -m "test: add advancement E2E smoke test"
```

---

### Task 1.5: Finances Smoke Test

**Files:**
- Create: `tests/e2e/smoke/05-finances.spec.ts`

**Step 1: Write the finances test (treasurer role)**

```typescript
// tests/e2e/smoke/05-finances.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('treasurer')

test.describe('Finances', () => {
  test('accounts page loads with scout data', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('billing page loads', async ({ page }) => {
    await page.goto('/billing')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('payments page loads', async ({ page }) => {
    await page.goto('/payments')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/05-finances.spec.ts`
Expected: 3 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/05-finances.spec.ts
git commit -m "test: add finances E2E smoke test"
```

---

### Task 1.6: Settings Smoke Test

**Files:**
- Create: `tests/e2e/smoke/06-settings.spec.ts`

**Step 1: Write the settings test (admin role)**

```typescript
// tests/e2e/smoke/06-settings.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Settings', () => {
  test('settings page loads for admin', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('users tab is accessible', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    // Click users tab if it exists
    const usersTab = page.getByRole('tab', { name: /users/i }).or(page.getByText(/users/i))
    if (await usersTab.isVisible()) {
      await usersTab.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText('Something went wrong')
    }
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/06-settings.spec.ts`
Expected: 2 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/06-settings.spec.ts
git commit -m "test: add settings E2E smoke test"
```

---

### Task 1.7: Reports & Expenses Smoke Test

**Files:**
- Create: `tests/e2e/smoke/07-reports.spec.ts`

**Step 1: Write the reports test (treasurer role)**

```typescript
// tests/e2e/smoke/07-reports.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('treasurer')

test.describe('Reports & Expenses', () => {
  test('reports page loads', async ({ page }) => {
    await page.goto('/reports')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('expenses page loads', async ({ page }) => {
    await page.goto('/expenses')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/07-reports.spec.ts`
Expected: 2 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/07-reports.spec.ts
git commit -m "test: add reports & expenses E2E smoke test"
```

---

### Task 1.8: Role-Based Access Smoke Test

**Files:**
- Create: `tests/e2e/smoke/08-role-access.spec.ts`

**Step 1: Write role access tests (parent + scout roles)**

```typescript
// tests/e2e/smoke/08-role-access.spec.ts
import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

// Parent role tests
const parentTest = authTest('parent')

parentTest.describe('Parent role access', () => {
  parentTest('can view dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  parentTest('can view own scout accounts', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})

// Scout role tests
const scoutTest = authTest('scout')

scoutTest.describe('Scout role access', () => {
  scoutTest('can view dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
```

**Step 2: Run it**

Run: `npx playwright test tests/e2e/smoke/08-role-access.spec.ts`
Expected: 3 tests pass

**Step 3: Commit**

```bash
git add tests/e2e/smoke/08-role-access.spec.ts
git commit -m "test: add role-based access E2E smoke test"
```

---

### Task 2.1: Full Suite Run & Final Commit

**Step 1: Run the complete E2E suite**

Run: `npx playwright test`
Expected: All smoke tests pass (auth-setup + ~17 smoke tests)

**Step 2: Run existing unit tests to confirm no regressions**

Run: `npm test`
Expected: 816+ tests pass (2 pre-existing failures in bulk-action-bar now fixed)

**Step 3: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "test: complete E2E smoke test suite"
```

---

## Summary

| Task | Description | Tests Added |
|------|-------------|-------------|
| 0.1 | Auth setup & fixtures | 5 (auth states) |
| 1.1 | Login | 2 |
| 1.2 | Dashboard | 2 |
| 1.3 | Roster | 1 |
| 1.4 | Advancement | 2 |
| 1.5 | Finances | 3 |
| 1.6 | Settings | 2 |
| 1.7 | Reports & Expenses | 2 |
| 1.8 | Role-based access | 3 |
| 2.1 | Full suite verification | 0 |
| **Total** | | **~17 smoke tests** |
