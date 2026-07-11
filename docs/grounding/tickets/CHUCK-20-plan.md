# Ticket Implementation Plan: CHUCK-20 — Split real-DB integration tests out of npm test (PLATFORM-009)

**Generated:** 2026-07-11
**Linear:** CHUCK-20 — https://linear.app/blaahd-projects/issue/CHUCK-20/split-real-db-integration-tests-out-of-npm-test-platform-009
**Branch:** richardblaalid/chuck-20-split-real-db-integration-tests-out-of-npm-test-platform-009 (worktree branch `CHUCK-20`)
**Status:** Planned
**Affects Features:** platform-foundation (pseudo-feature)
**Epic:** CHUCK-2 — Epic B: Delivery Infrastructure

## Ticket Summary

Give `tests/integration/` its own vitest config and `npm run test:integration` script, and exclude the directory from the default run so `make test` is hermetic — it must never touch the shared dev Supabase database, even when `.env.local` (with the service-role key) is present. CI stays functionally unchanged.

## Epic Context

- **Epic:** CHUCK-2 — Epic B, Delivery Infrastructure (CI, monitoring, schema hygiene; audit §3 P0-4).
- **Sibling tickets:**
  - CHUCK-17 — **Done** — lint errors + CI repo secrets; CI is now green, which this ticket must not regress.
  - CHUCK-21 — Todo — PLATFORM-010: typecheck `tests/**` + coverage thresholds. **Depends on this ticket** (PLATFORM-010 lists PLATFORM-009 as a dependency). Coverage-threshold work is CHUCK-21's scope — this ticket does not touch coverage config.
  - CHUCK-18 (prod schema reconcile), CHUCK-19 (Sentry) — Todo — no file overlap.
- **This ticket's boundary:** vitest config split + `test:integration` script + doc sync only. No coverage thresholds (CHUCK-21), no new integration tests (finance integration tests are an Epic A companion ticket), no CI workflow changes.

## Grounding Extract

- **Decisions implied** — Integration tests are invoked explicitly (`npm run test:integration`), never implicitly via `npm test`. Mirrors finance-test spec Decision #3 ("`npm test` continues to run only fast mocked tests").
- **Changed requirements** — Default suite (`make test`, CI, pre-push consumers) excludes `tests/integration/`; hermetic regardless of local env files.
- **Technical signals** — Root cause: `vitest.config.ts` includes all `**/*.test.ts` and `loadEnv(mode, cwd, '')` injects `.env.local` (incl. `SUPABASE_SERVICE_ROLE_KEY`) into every test, so the three `tests/integration/` files connect to the shared dev DB whenever a dev machine runs `npm test`. The 12 advancement tests account for ~90s of the ~91s suite.
- **Acceptance criteria** — see Verification Plan.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/` — PLATFORM-009 already exists in Active Tasks ("Split real-DB integration tests out of `npm test`… unit runs become hermetic"). Parallelization guide places it in lane-B (test config only) — consistent with this worktree.
- **Active DRs that apply:** DR-2026-07-09-custom-double-entry-ledger-v1 — not directly constraining (no ledger code touched); its integration-test obligations are the Epic A companion ticket.
- **Conflicts detected (1, reconciled — confirm at gate):** Legacy spec `2026-05-25-finance-integration-tests-design.md` Decision #3 says "**CI runs both**" (unit + integration). The ticket says "**CI unchanged**", and `ci.yml` deliberately omits the service-role key ("must never mutate the dev DB from CI"). **Resolution: follow the ticket** — integration stays out of CI; the legacy spec is read-only history and its CI clause is superseded by the audit. No `/decide` needed (no live DR contradicted).
- **Decision-record needed?** No — this executes an already-recorded decision (spec Decision #3 invocation split + audit M1); no new choice between alternatives with consequences.

## Task List

Tasks in `docs/features/platform-foundation/tasks.md` (PLATFORM-009 pre-exists; PLATFORM-013 claimed as next free ID).

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-009 | Add `vitest.integration.config.ts` (node env, `tests/integration/**` only, real env via `loadEnv`, 30s timeout, no jsdom setup file); exclude `tests/integration` from `vitest.config.ts`; add `test:integration` npm script | no | none | Build-and-smoke: `make test` collects 0 integration files; `npm run test:integration` collects exactly the 3 integration files |
| PLATFORM-013 | Sync docs after the split: `docs/testing.md` layers table + known-gaps queue, `ci.yml` stale comment (comment-only — workflow steps untouched), mark PLATFORM-009 complete | no | PLATFORM-009 | Docs match reality; `git diff ci.yml` shows comment-only change |

### Implementation notes

- **Integration config runs in `node` environment without `tests/setup.ts`** — that setup file is jsdom-coupled (RTL cleanup, `Element.prototype.scrollIntoView`, next/navigation mocks) and stubs Supabase env vars; integration tests need real env and no DOM. All three integration files use only `@supabase/supabase-js`.
- **Unit config keeps `loadEnv`** (minimal change): hermeticity comes from excluding the directory that contains every real-DB test, not from stripping env — stripping env from the unit run risks breaking mock-heavy unit tests that read other vars, and is not required by the done-when.
- Existing `describe.skip`-when-unconfigured guards in the integration files stay — they make `test:integration` degrade gracefully where credentials are absent (e.g. CI, fresh worktrees).

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified |
|---|---|---|
| 1 | `make test` green with no `.env.local` present, <15s wall | Run `make test` in this worktree (has no `.env.local`). Baseline pre-change: 64 passed / 3 skipped, 7.33s. Post-change: all green, integration files not collected at all, duration <15s |
| 2 | `make test` never touches the DB even when `.env.local` exists | Copy `.env.local` from main checkout, run `npx vitest list` + `make test`: zero `tests/integration/` files collected (the only files that open real DB connections) |
| 3 | `npm run test:integration` runs the real-DB suite standalone | With `.env.local` present, run it: the 3 integration files execute against the dev DB (TestContext cleanup, test-prefixed UUIDs) and pass |
| 4 | CI unchanged | `git diff .github/workflows/ci.yml` — comment-only; job/steps byte-identical |

## Screenshot Plan

No app UI is implicated — this is delivery-infrastructure work with no route, so there is no role-authenticated page to capture (infra tasks verify build-and-smoke per root CLAUDE.md). Evidence in lieu of an app screenshot: terminal output of AC runs 1–3 rendered to `docs/grounding/tickets/CHUCK-20-screenshots/verification-terminal.png` and embedded on the ticket.

## Open Questions

- None blocking. Flagged for awareness: AC 3 requires one real integration run against the shared dev DB from this worktree (test-prefixed data, self-cleaning). Will note on the ticket when it happens in case a parallel run is active.
