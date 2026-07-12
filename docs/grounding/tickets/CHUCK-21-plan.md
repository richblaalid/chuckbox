# Ticket Implementation Plan: CHUCK-21 — Typecheck tests/ + coverage thresholds (PLATFORM-010)

**Generated:** 2026-07-11
**Linear:** CHUCK-21 — https://linear.app/blaahd-projects/issue/CHUCK-21/typecheck-tests-coverage-thresholds-platform-010
**Branch:** richardblaalid/chuck-21-typecheck-tests-coverage-thresholds-platform-010 (running in worktree branch `CHUCK-21`)
**Status:** Verified — all ACs pass (see results in the Verification Plan; raw output in `CHUCK-21-evidence.txt`)
**Affects Features:** platform-foundation (pseudo-feature)
**Epic:** CHUCK-2 — Epic B, Delivery Infrastructure

## Ticket Summary

Bring `tests/**` into the TypeScript gate (it is explicitly excluded in `tsconfig.json` today), add a `json-summary` coverage reporter plus enforced thresholds to the vitest config, and regenerate the coverage snapshot (stale since 2026-02-04). Done when a test-scoped `tsc --noEmit` is wired into the standard verbs and a coverage breach fails the build.

## Epic Context

- **Epic:** CHUCK-2 — Epic B, Delivery Infrastructure (CI, monitoring, schema hygiene from the 2026-07-09 audit). This ticket is audit items M2 + M5.
- **Sibling tickets:** CHUCK-17 (Done — lint zeroed, CI secrets), CHUCK-20 (Done — PLATFORM-009 integration split; this ticket's declared dependency, satisfied), CHUCK-19 (In Progress — Sentry, lane-A, no file overlap), CHUCK-18 (Todo — schema reconciliation, lane-A).
- **This ticket's boundary:** test-suite typecheck + coverage enforcement only (lane-B, PLATFORM-010). Sentry/logger and Supabase schema work belong to lane-A siblings. CHUCK-19 is in flight in a parallel worktree — this ticket touches `tsconfig*`, `vitest.config.ts`, `Makefile`, `tests/**`, `docs/testing.md`; small collision risk on `docs/testing.md`/`Makefile` if CHUCK-19 edits them (noted, low).

## Grounding Extract

- **Decisions implied** — tests get their own tsconfig (`tsconfig.test.json`) rather than un-excluding `tests/**` from the root config (the root config feeds `next build`, which must not typecheck test files); coverage thresholds become a hard gate.
- **New requirements** — platform capability: type drift in test helpers/fixtures surfaces at typecheck time, not runtime; coverage regressions fail the build.
- **Technical signals** — probe results (2026-07-11): a candidate `tsconfig.test.json` surfaces **49 pre-existing type errors across 10 files**, all test-side (stale fixture shapes missing newer required fields, over-narrow literal-type comparisons, one intentionally-bad lint fixture, one `boolean | null` in integration seed). No product code changes required. Current coverage: **60.78% stmts / 53.99% branch / 58.45% funcs / 61.1% lines**. Coverage adds ~0.6s wall to the ~5s suite.
- **Acceptance criteria** — see Verification Plan.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/requirements.md` capability 1 ("one definition of green" — local, hook, CI run the same verbs) and 3 (CI parity: CI runs exactly `make build → lint → test`). This constrains *where* the new gates wire in: extending `make test` keeps CI/hook parity for free; adding a new verb would require editing `ci.yml` and re-syncing docs.
- **Active DRs that apply:** none directly (DR-2026-07-09-custom-double-entry-ledger-v1 binds finance test obligations but doesn't constrain this wiring).
- **Conflicts detected:** none. `docs/testing.md` gaps #2 and #4 are exactly this ticket; both get resolved/updated.
- **Decision-record needed?** No — this is delivery-infrastructure wiring with an obvious shape, tracked as audit follow-up. The one judgment call (threshold values) is surfaced as an open question at the gate, recorded in `vitest.config.ts` + `docs/testing.md`, not DR-worthy.

## Task List

Tasks in `docs/features/platform-foundation/tasks.md` (PLATFORM-010 existed; 014–015 claimed; next free ID now PLATFORM-016).

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-010 | Add `tsconfig.test.json` (extends root; includes `tests/**` + both vitest configs; vitest/jest-dom/node types) and fix the 49 pre-existing type errors in test files | no | none (PLATFORM-009 done) | `npx tsc -p tsconfig.test.json --noEmit` exit 0; `make test` still 1,210 green |
| PLATFORM-014 | Wire the test typecheck into the gate: `make test` runs `npx tsc -p tsconfig.test.json --noEmit` before vitest | no | PLATFORM-010 | `make test` green; injected type error in a test file fails the verb |
| PLATFORM-015 | Coverage enforcement: add `json-summary` reporter + thresholds (stmts 58 / branch 51 / funcs 55 / lines 58) to `vitest.config.ts`; run coverage in `make test` (`vitest run --coverage`); regenerate report; sync `docs/testing.md` (snapshot + gaps #2/#4) | no | PLATFORM-014 | Fresh `coverage/coverage-summary.json`; threshold breach fails `make test`; docs updated |

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified | Result (2026-07-12) |
|---|---|---|---|
| 1 | `tests/**` is inside the typecheck gate | `npx tsc -p tsconfig.test.json --noEmit` exits 0; introducing a deliberate type error in a test file makes it (and `make test`) exit non-zero | **PASS** — exit 0 clean; injected `const chuck21TypeProbe: number = 'x'` → `error TS2322`, `make test` exit 2 |
| 2 | The test typecheck is wired into CI | CI runs `make test` unchanged; `make test` now includes the tsc step (capability-1 parity — no ci.yml edit needed) | **PASS** — tsc step is line 1 of the `test` verb; ci.yml untouched |
| 3 | Coverage report is fresh with `json-summary` | `coverage/coverage-summary.json` regenerated by the final `make test` run, dated today | **PASS** — regenerated 2026-07-12; totals 60.78/53.99/58.45/61.1 |
| 4 | Thresholds fail the build when breached | Temporarily raising a threshold above current coverage makes `make test` exit non-zero (demonstrated, then reverted) | **PASS** — statements floor 58→90: `ERROR: Coverage for statements (60.78%) does not meet global threshold (90%)`, exit 2; reverted |
| 5 | Existing suite still green | `make build`, `make lint`, `make test` all green; baseline diff clean (baseline was fully green: 64 files / 1,210 tests) | **PASS** — build 0, lint 0 (0 warnings), test 0 with 64 files / 1,210 tests |

## Screenshot Plan

- **Not applicable — no UI surface.** This is delivery-infrastructure; every AC is CLI-observable. Evidence will be terminal output (tsc exit code, vitest coverage summary, demonstrated threshold failure) posted to the ticket in lieu of an app screenshot.

## Open Questions

1. **Threshold values (the "agreed thresholds" in the ticket).** Proposal: a ratchet floor ~2–3 points below current — statements 58, branches 51, functions 55, lines 58. Blocks regressions without demanding new tests in this ticket; can be raised as coverage grows.
2. **Coverage in every `make test` run.** Proposal: yes — it costs ~0.6s and is the only way a breach "fails the build" given CI runs exactly the make verbs. Alternative (separate `test:coverage` CI step) breaks capability-3 parity.
