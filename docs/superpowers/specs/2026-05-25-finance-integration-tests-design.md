---
status: approved
last_verified: 2026-05-25
---

# Finance-Flow Integration Tests — Design

## Status

Brainstormed and approved on 2026-05-25. Follow-up to PR #36 (payment-modal charge-allocation work), motivated by a regression discovered during smoke testing — the card-payment path was missing allocations and our existing mocked tests didn't catch it. This spec scopes a focused integration-test harness that exercises real Postgres transactions, designed to catch the same class of bug going forward.

## Why

The PR #36 work shipped with three layers of tests:
- Unit tests for the allocation engine (pure functions).
- Component tests for the payment modal (mocked Supabase).
- Server-action tests for `recordQuickPayment` (mocked Supabase).

All three passed. But the `/api/square/payments` route — a separate code path — wasn't covered by these tests. Card payments went through it without sending allocations, so per-charge `paid_amount` writes never happened, and the scout's overall billing balance diverged from the per-charge state. Mocked tests verified the form's *intent* but not the *outcome* of the full transaction.

The same bug pattern could exist in other finance flows (void, reconcile, expense reimbursement, advancement-related writes). The fix is a focused integration-test harness that exercises real Postgres transactions and asserts on resulting database state — including journal balance, allocation sums, and per-charge `paid_amount`.

## Scope

**In scope (v1):** ~15 integration tests covering the finance critical path — cash payment, card payment, funds transfer, void payment, plus universal invariants (journal balance, allocation sum). All tests run against the dev Supabase project (`feownmcpkfugkcivdoal`) with per-test seed-and-cleanup.

**Out of scope (defer to v2 or later):**
- All RPCs (beyond finance flows): reconcile, create_billing_with_journal cohort behavior, expense reimbursement journals, advancement-related writes.
- Parallel execution within the integration suite.
- E2E browser tests for the payment modal (would be a separate Playwright effort).
- Test database fixtures via factories (Faker, etc.) — explicit literal data improves traceability.
- Snapshot testing of journal-entry shapes (too brittle).

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  tests/integration/                                               │
│  ─────────────────                                                │
│  helpers/                                                         │
│    db-clients.ts        — service-role + user-session factories   │
│    fixtures.ts          — TestData class: scouts, accounts,       │
│                            billing records, charges. Tracks IDs.  │
│    cleanup.ts           — reverse-dependency-order deletes        │
│                                                                   │
│  payments/                                                        │
│    record-quick-payment.test.ts   — cash/check via server action  │
│    square-payment.test.ts         — card via /api/square/payments │
│    funds-transfer.test.ts         — transfer_funds_to_billing RPC │
│    void-payment.test.ts           — void + journal reversal       │
│                                                                   │
│  invariants/                                                      │
│    journal-balance.test.ts        — debits == credits invariant   │
│    allocation-sum.test.ts         — sum(allocations) == amount    │
└───────────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  Dev Supabase (feownmcpkfugkcivdoal)                              │
│  • Per-test isolated data via unique IDs                          │
│  • Cleanup runs after each test (afterEach hook)                  │
│  • Service-role key for setup/teardown                            │
│  • Authenticated session (treasurer test user) for the RPC call   │
└───────────────────────────────────────────────────────────────────┘
```

**Two layers of tests:**
1. **Per-flow tests** (one file per finance flow) — set up a scenario, exercise the flow, assert on resulting DB state.
2. **Invariant tests** — run after each finance test via `afterEach` hook, assert universal properties (journal balanced, allocations sum to payment, paid_amount ≤ amount).

**Decisions locked during brainstorming:**

| # | Decision |
|---|---|
| 1 | **Test isolation:** per-test seed-and-cleanup against dev DB. Each test creates uniquely-prefixed data (e.g., `integration-test-{uuid}`), exercises the flow, deletes its artifacts in `afterEach`. |
| 2 | **Scope:** finance critical path only (~15 tests). Expand to other RPCs and flows in a v2 spec after v1 patterns are proven. |
| 3 | **Invocation:** `npm run test:integration` as a separate command. `npm test` continues to run only fast mocked tests. CI runs both. New tests live in `tests/integration/`. |
| 4 | **Auth:** service-role for setup/cleanup, authenticated treasurer session for the actual operation under test. Tests the realistic auth path while keeping ground-truth setup privileged. |

## Test fixtures & helpers

### `tests/integration/helpers/db-clients.ts`

Two client factories:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Bypasses RLS — for setup/cleanup only. Never use in the assertion under test. */
export function serviceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Authenticated as a real test user — for the actual RPC/action call under test. */
export async function signInAsTreasurer(): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  const email = process.env.INTEGRATION_TEST_USER_EMAIL || 'richard.blaalid+treasurer@withcaldera.com'
  const password = process.env.INTEGRATION_TEST_USER_PASSWORD || 'testpassword123'

  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Failed to sign in test user: ${error.message}`)

  return client
}
```

Test users (`treasurer`, `admin`, `parent`) already exist in dev seed (`npm run db:seed:test`). Tests sign in; they don't provision users.

### `tests/integration/helpers/fixtures.ts`

Pure-data builders that insert into the DB via service-role client. Each instance tracks the IDs it created for cleanup:

```ts
export class TestData {
  private client: SupabaseClient
  private createdScouts: string[] = []
  private createdScoutAccounts: string[] = []
  private createdBillingRecords: string[] = []
  private createdBillingCharges: string[] = []
  private createdPayments: string[] = []
  private createdJournalEntries: string[] = []
  private testRunPrefix: string  // e.g., "integration-test-abc123"

  constructor() {
    this.client = serviceRoleClient()
    this.testRunPrefix = `integration-test-${crypto.randomUUID().slice(0, 8)}`
  }

  async createScout(opts: {
    unitId: string  // must be provided — tests typically use an existing seeded unit
    firstName?: string
    lastName?: string
    fundsBalance?: number
    billingBalance?: number
  }): Promise<{ scoutId: string; scoutAccountId: string }> {
    // Inserts scout + scout_account; sets balances if provided.
    // Records IDs in createdScouts and createdScoutAccounts.
    // Returns both IDs.
  }

  async createBillingRecord(opts: {
    unitId: string
    description: string
    totalAmount: number
    billingDate?: string
    scoutAccounts: Array<{ scoutAccountId: string; amount: number }>
  }): Promise<{ billingRecordId: string; chargeIds: string[] }> {
    // Inserts billing_record + billing_charges per scout_account.
    // Description prefixed with this.testRunPrefix for cleanup safety net.
    // Returns IDs.
  }

  async cleanup(): Promise<void> {
    // Reverse-order delete: payment_allocations → payments → journal_lines →
    // journal_entries → billing_charges → billing_records → scout_accounts → scouts.
    // Uses service-role; ignores not-found errors (idempotent).
  }
}
```

### `tests/integration/helpers/cleanup.ts`

Module-level orphan-cleanup script for the case where a test crashes:

```ts
/**
 * Sweep test artifacts based on the integration-test-* naming prefix.
 * Run manually via: `npx tsx scripts/clean-integration-test-data.ts`
 */
export async function cleanAllTestData(): Promise<{ deletedCount: number }> {
  const client = serviceRoleClient()
  // Find all billing_records with description LIKE 'integration-test-%'
  // Find all scouts with first_name OR last_name LIKE 'integration-test-%'
  // Delete in reverse dependency order
}
```

Also produces a `scripts/clean-integration-test-data.ts` thin wrapper that calls this helper and reports the count.

### Per-test usage pattern

```ts
describe('recordQuickPayment', () => {
  let td: TestData
  let client: SupabaseClient
  const UNIT_ID = '<a known seeded unit id>'  // resolved at test-suite startup

  beforeEach(async () => {
    td = new TestData()
    client = await signInAsTreasurer()
  })

  afterEach(async () => {
    await td.cleanup()
    await client.auth.signOut()
  })

  it('writes paid_amount when allocations are provided', async () => {
    const { scoutAccountId } = await td.createScout({ unitId: UNIT_ID })
    const { chargeIds } = await td.createBillingRecord({
      unitId: UNIT_ID,
      description: 'integration-test-camp-fee',
      totalAmount: 25,
      scoutAccounts: [{ scoutAccountId, amount: 25 }],
    })

    // Exercise the flow under test
    const result = await recordQuickPayment({
      unitId: UNIT_ID,
      scoutAccountId,
      scoutName: 'Test Scout',
      amountDollars: 25,
      method: 'cash',
      allocations: [{ chargeId: chargeIds[0], amount: 25 }],
    })

    expect(result.success).toBe(true)

    // Assert on real DB state via service-role client (don't trust the action's return)
    const verifyClient = serviceRoleClient()
    const { data: charge } = await verifyClient
      .from('billing_charges')
      .select('paid_amount, is_paid')
      .eq('id', chargeIds[0])
      .single()
    expect(charge?.paid_amount).toBe(25)
    expect(charge?.is_paid).toBe(true)
  })
})
```

## Test catalogue (v1)

### `payments/record-quick-payment.test.ts` (5 tests)

1. **Cash payment with single-charge allocation writes paid_amount.** $25 charge, $25 payment, $25 allocation. Assert `paid_amount = 25`, `is_paid = true` (trigger fires), `payment_allocations` row exists, `scout_accounts.billing_balance = 0`.
2. **Cash payment with multi-charge allocation matches per-row distribution.** Scout with A($30) + B($25). $40 payment with allocations `[{A: 30}, {B: 10}]`. Assert A.paid_amount=30, A.is_paid=true, B.paid_amount=10, B.is_paid=false, billing_balance reflects $40 reduction.
3. **Allocation sum mismatch rejects with no DB changes.** $10 payment, $20 allocation. Assert `result.success === false`, error includes "does not match", no new journal_entries for this scout.
4. **Charge not owned by scout rejects.** Two scouts seeded; call action for scout1 with scout2's charge ID. Assert rejected, no DB changes.
5. **No auto-transfer to funds when somehow overpayment occurs.** Construct a scenario where billing_balance becomes positive post-payment (e.g., by pre-setting a credit). Assert `funds_balance` unchanged.

### `payments/square-payment.test.ts` (3 tests)

Mocks Square's external SDK at the module level (`vi.mock('squareup', ...)`). Route's DB operations run against the real DB.

6. **Card payment with allocations writes payment_allocations + paid_amount.** Seed scout + charge. POST to `/api/square/payments` with `allocations` array. Assert: payment row with `square_payment_id`, payment_allocations rows match input, paid_amount updated, journal balanced.
7. **Card payment without allocations writes journal but not allocations.** Backward-compat — the route allows omitting allocations. Assert payment row exists, journal balanced, no payment_allocations, paid_amount unchanged. Documents the scout-level-only path.
8. **Card fee math: gross debits AR, net debits bank.** POST with $103.20 gross. Assert AR account credited $103.20, bank account debited $96.80 (or whatever the route's calculateFee produces), journal balances.

### `payments/funds-transfer.test.ts` (3 tests)

9. **Funds transfer with allocations writes paid_amount.** Scout with funds=$25 and $25 charge. Call `transfer_funds_to_billing` via authenticated client with `p_allocations: [{charge_id, amount: 25}]`. Assert `paid_amount = 25`, `is_paid = true`, `funds_balance = 0`, `billing_balance = 0`, journal balanced.
10. **Partial funds transfer leaves charge partially paid.** Scout with funds=$5 and $25 charge. Call with $5 + allocations `[{chargeId, amount: 5}]`. Assert `paid_amount = 5`, `is_paid = false`, `billing_balance = -20`.
11. **Funds transfer with mismatched allocation sum rejects.** Call with `p_amount: 10, p_allocations: [{charge_id, amount: 5}]`. Assert RPC raises, no journal entry, balances unchanged.

### `payments/void-payment.test.ts` (2 tests)

12. **Voiding a payment reverses journal + restores balances.** Record a payment (Scenario 1), then void it. Assert payment.status='voided', reversal journal entry exists, debits=credits on original and reversal, billing_balance restored, paid_amount on charges reset.
13. **Voided payment leaves payment_allocations rows intact for audit.** Same scenario. Verify rows still exist (the void doesn't physically delete them), payment marked voided.

### `invariants/journal-balance.test.ts` (2 invariants, auto-run via shared afterEach)

These are not standalone scenarios — they wrap each finance test's `afterEach`:

14. **For every journal_entry created during the test, sum(debits) === sum(credits).** Query journal_entries by the test's TestData-tracked IDs, inner join journal_lines, group by entry, assert balanced. Failure means a journal-writing bug just escaped.
15. **For every payment created during the test, sum(payment_allocations.amount) === payment.amount.** Catches Bug 4-style drift where allocations don't sum to the actual cash.

Total: **15 tests across 4 flow files + 2 invariants**.

## Operational details

### Environment variables

| Variable | Purpose | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev project URL | `.env.local`; CI secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for user-session client | `.env.local`; CI secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for setup/cleanup | `.env.local`; CI secret |
| `INTEGRATION_TEST_USER_EMAIL` | Test user (defaults to treasurer) | Optional |
| `INTEGRATION_TEST_USER_PASSWORD` | Test user password | Optional |

CI: add `SUPABASE_SERVICE_ROLE_KEY` to GitHub Actions secrets. The integration tests run against dev. PROD is never touched by the test harness.

### `npm run test:integration`

New `package.json` script:

```json
{
  "scripts": {
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

New `vitest.integration.config.ts` (sibling to `vitest.config.ts`):

```ts
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    test: {
      environment: 'node',
      setupFiles: [],
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      exclude: ['tests/unit', 'tests/e2e', 'node_modules', '.next'],
      env,
      testTimeout: 30000,
      pool: 'forks',
      maxWorkers: 1,  // serial execution for v1; revisit if too slow
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
  }
})
```

Note: `node` environment (not jsdom) — integration tests don't render React.

### CI integration

Add two steps to the existing GitHub Actions workflow (or create a new one if there isn't one yet — the plan will determine which):

```yaml
- name: Unit tests
  run: npm test

- name: Integration tests
  run: npm run test:integration
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

If no CI workflow exists, the implementation plan should add one. Vercel preview deploys already gate PRs visually; this adds correctness gating for transaction logic.

### Performance budget

- Total v1 suite (15 tests): **under 60 seconds**.
- Per-test estimate: ~2-3s (seed 500ms, action 500ms, asserts 500ms, cleanup 500ms, slack).
- If we exceed the budget, revisit `maxWorkers: 1` → enable parallelism (each test's data island is independent).

### Failure handling

- **Orphan cleanup safety net.** `scripts/clean-integration-test-data.ts` finds and deletes any row whose name starts with `integration-test-`. Runs manually if a test crashes and leaves data behind.
- **Test data identification.** All fixtures use the `integration-test-` prefix (scout names, billing descriptions, etc.). The cleanup script sweeps deterministically.
- **CI failure surfaces logs.** Vitest's verbose output shows which test created which orphans; cleanup script can be run manually if needed.

### Why these are not v1

| Deferred | Why |
|---|---|
| Parallel execution | Needs proven serial-perf baseline first; serial is also debuggable. |
| Production-mirror DB | Security risk; dev is sufficient for catching the bugs we care about. |
| Faker-generated test data | Explicit literal values trace better when a test fails; deterministic = debuggable. |
| Snapshot tests of journal shapes | Brittle; would break on any schema evolution. |
| Browser E2E for payment modal | Different tool (Playwright); slower; separate effort. |
| Coverage of every RPC | YAGNI for v1; expand once patterns are proven. |

## Files involved (when implementation lands)

**Create:**
- `tests/integration/helpers/db-clients.ts`
- `tests/integration/helpers/fixtures.ts`
- `tests/integration/helpers/cleanup.ts`
- `tests/integration/payments/record-quick-payment.test.ts`
- `tests/integration/payments/square-payment.test.ts`
- `tests/integration/payments/funds-transfer.test.ts`
- `tests/integration/payments/void-payment.test.ts`
- `tests/integration/invariants/journal-balance.test.ts`
- `vitest.integration.config.ts`
- `scripts/clean-integration-test-data.ts`

**Modify:**
- `package.json` (add `test:integration` script)
- `.github/workflows/<existing>.yml` if CI exists, or create one

**Untouched:**
- `vitest.config.ts` (existing unit-test config stays as-is)
- Any `src/**` file (this is purely a test-infrastructure change)
- Migrations (this work doesn't change any RPCs or schemas)

## Out of scope (explicitly NOT shipping with this work)

- Backfilling test coverage for non-finance RPCs (advancement, expense reimbursement, etc.) — v2 spec.
- E2E browser tests for the payment modal — separate Playwright work.
- Pre-PR hooks that auto-run integration tests locally — manual `npm run test:integration` before push is sufficient.
- Performance optimization beyond serial execution — revisit only if we breach the 60s budget.

## Follow-up work

After v1 ships and the patterns are proven:

- **v2: Expand to non-finance RPCs.** Same harness, new tests for advancement, expense reimbursement, etc.
- **v2.5: Parallel execution.** Enable `maxWorkers > 1` once we have data on serial perf.
- **v3: E2E browser tests for the payment modal.** Different tool (Playwright), separate spec.
- **Production monitoring:** Optional separate work — periodic invariant queries against prod (debits=credits, allocation sums) with alerting.

## Why this work matters

PR #36 fixed five real bugs in the payment modal, but the regression discovered during smoke testing (card-path missing allocations) demonstrated that mocked tests can't catch full-stack transaction bugs. The cost of a missed regression in finance code is high — silent data drift, audit gaps, treasurer confusion. A focused integration harness covering ~15 critical-path scenarios closes the most important gap with bounded effort (~1 day of implementation, ~60s of CI time per PR).
