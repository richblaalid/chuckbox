# Chuckbox — Testing Strategy & Snapshot

**Status:** honest snapshot as of 2026-07-11. Fresh verified baseline: `npx tsc --noEmit` exit 0, `npm run build` exit 0, hermetic unit run 64 files / 1,210 tests all passing (~4s); real-DB integration suite (3 files / 36 tests) runs separately via `npm run test:integration`.

## Layers

| Layer | Location | State |
|---|---|---|
| Unit (Vitest + RTL) | `tests/unit/` | Strong for finance pure logic (`charge-allocation`, `billing`, `cost-sharing-calc` are exemplary behavioral tests); action tests are mock-heavy |
| Integration (real dev DB) | `tests/integration/` | Advancement, RPC authz, BSA seed validation (36 tests, TestContext harness with cleanup). Runs **only** via `npm run test:integration` (`vitest.integration.config.ts`); excluded from `make test`, so the default run never touches the shared dev DB (PLATFORM-009) |
| E2E (Playwright) | `tests/e2e/smoke/` | Page-load smoke only, 5-role auth harness (`global-setup.ts`, chunked-cookie injection). No user flows yet |
| RLS / RPC (SQL) | — | **None** — critical gap for a finance app on Supabase |

## Make verbs (what green means)

`make build` → Next production build (type gate). `make lint` → ESLint 9 flat config incl. custom `no-single-on-unit-memberships` rule. `make test` → `npx vitest run` (hermetic — no DB, no `.env.local` needed). CI, the pre-push hook, and local runs all execute the same verbs. The real-DB suite is a deliberate extra step: `npm run test:integration` (dev credentials required; never run from CI).

## Acceptance criteria conventions

- ACs live in `docs/features/[feature]/tests.md` as `AC-[FEATURE]-NNN`, written Given/When/Then, behavior-not-implementation (see the AC Principle in `docs/CLAUDE.md`).
- Every `/implement` and `/qa` run proves ACs against the running app (authenticated as the implicated role — see Test User Credentials in root `CLAUDE.md`) and attaches screenshot evidence.
- Business-logic tasks are TDD: the failing test that encodes the AC comes first.

## Money edge cases — required coverage for finance work

Rounding (round-to-cent, fee ceil, net+fee==gross), allocation (FIFO, partial, zero/negative, over-payment caps), void reversal (journal + balances + allocations), journal balance invariant (Σdebit = Σcredit), idempotency (webhook redelivery, request retry). Unit-level coverage exists for the first two; the transactional invariants are specified in `docs/superpowers/specs/2026-05-25-finance-integration-tests-design.md` (approved, unimplemented — platform-foundation task) and are **binding obligations** under [DR-2026-07-09-custom-double-entry-ledger-v1](decisions/DR-2026-07-09-custom-double-entry-ledger-v1.md).

## Known gaps (test-debt queue)

1. Finance integration tests per approved spec (highest priority — encodes the ledger invariants)
2. Test code excluded from typecheck (`tsconfig.json` excludes `tests/**`)
3. 2 of 47 API routes have tests; e2e has no user flows; no multi-unit e2e (runbook phases D/E/F/H manual)
4. Coverage report stale (Feb 2026), no thresholds
