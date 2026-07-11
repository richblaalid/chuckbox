# Platform Foundation — Tasks

Task IDs use the prefix `PLATFORM-`. **Next free ID: PLATFORM-017.** (Claim ranges explicitly and update this note — see `docs/process.md` Task ID discipline. PLATFORM-013–016 claimed by CHUCK-19, 2026-07-11.)

## Summary

| Group | Count | Priority |
|---|---|---|
| Method adoption (this installation) | 6 | P0 |
| Delivery infrastructure follow-ups | 4 | P0/P1 |
| Finance hardening (Epic A / CHUCK-7) | 1 | P0 |

## Parallelization Guide

### Phase 0 — Method adoption (single lane, sequential)

The installation itself; one worktree (main tree — nothing else runs during adoption).

| Tasks | Worktree | Deliverables |
|---|---|---|
| `PLATFORM-001` → `006` | main tree | Skills + doc system + Makefile/hooks/CI + root CLAUDE.md + process.md + verified dry-run |

### Phase 1 — Delivery-infrastructure follow-ups (2 parallel lanes)

After Phase 0 merges. Lane B touches test config only; Lane A touches Supabase/monitoring — no file overlap.

| Lane | Tasks | Worktree | Deliverables |
|---|---|---|---|
| lane-A | `PLATFORM-007` → `008` | `wt-platform-ops` | Prod/dev schema reconciliation; Sentry |
| lane-B | `PLATFORM-009` → `010` | `wt-platform-test` | `test:integration` split; tests in typecheck |

## Active Tasks

| Task ID | Description | TDD? | Dependencies | Status | Verification |
|---|---|---|---|---|---|
| PLATFORM-007 | Reconcile prod schema with migration ledger: diff prod against `supabase/migrations/` chain; commit or delete the three untracked `supabase/scripts/*.sql`; document the single push path in docs/tech.md | no | none | Not Started | Schema diff clean; scripts resolved; **requires explicit user approval for any prod touch** |
| PLATFORM-008 | Add Sentry error tracking (app + server actions); route the `console.error` hot paths through `src/lib/logger.ts` — **decomposed into PLATFORM-013…016 (CHUCK-19)** | no | none | Decomposed | See PLATFORM-013…016 |
| PLATFORM-015 | CHUCK-19: extend `src/lib/logger.ts` — `.error()` forwards to Sentry with namespace tag + data context; unit tests with mocked `@sentry/nextjs` | yes | PLATFORM-013 | Not Started | new vitest file green; suite green |
| PLATFORM-016 | CHUCK-19: route the 47 finance-path `console.error` sites (15 files: `api/square/**`, `api/payment-links/**`, `actions/{payments,expenses,reconcile}.ts`, `lib/square/sync.ts`, `pay/[token]/page.tsx`) through `logger.*.error`; no control-flow changes | no | PLATFORM-015 | Not Started | grep 0 `console.error` in those files; lint + typecheck + suite green |
| PLATFORM-009 | Split real-DB integration tests out of `npm test` into `test:integration` (per approved spec 2026-05-25 Decision #3); unit runs become hermetic | no | none | Not Started | `make test` green with no `.env.local`; integration suite runs standalone |
| PLATFORM-010 | Bring `tests/**` into typecheck (tsconfig.test.json or include) and add coverage `json-summary` + thresholds | no | PLATFORM-009 | Not Started | `npx tsc --noEmit` covers tests; fresh coverage report |

## Completed Tasks

| Task ID | Description | Completed | Commit |
|---|---|---|---|
| PLATFORM-014 | CHUCK-19: wire error boundaries + context — `Sentry.captureException` in `(dashboard)/error.tsx` + `global-error.tsx`, `SentryIdentify` (setUser + role/unit tags) in dashboard layout, release + environment on all inits | 2026-07-11 | db11113 |
| PLATFORM-013 | CHUCK-19: install `@sentry/nextjs` — `src/instrumentation.ts` (+`onRequestError`), `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `withSentryConfig` in `next.config.mjs`, env plumbing (no-op without DSN), `.env.local.example` + `docs/tech.md` updates | 2026-07-11 | bcf5f68 |
| PLATFORM-012 | CHUCK-17: remove the 8 unused `eslint-disable` directives (5 files) — `make lint` now 0 errors / 0 warnings; rest of CHUCK-17 (rename, signup-wizard fix, repo secrets) already delivered via CHUCK-7/PR #37 | 2026-07-11 | 3df2615 |
| PLATFORM-011 | CHUCK-7: TDD regression tests (`tests/integration/rpc-authz.test.ts`) + migration `20260710000001_rpc_role_checks.sql` adding internal authz to `transfer_funds_to_billing` / `auto_transfer_overpayment` / `void_payment` (service_role OR admin/treasurer; + guardian-of-scout for transfer); dev push only | 2026-07-10 | e97a1fe |
| PLATFORM-001 | Copy the method's generic skills (ground, decide, execute) into `.claude/skills/`; verify zero source-project references | 2026-07-09 | 57af239 |
| PLATFORM-002 | Copy + parameterize Linear-coupled skills (implement, qa, presentation, epic-progress) for CHUCK/Chuckbox/`epic:*`+`Epic [A-Z] —`; adapt stack machinery to Next.js+Supabase; zero-grep gate passed | 2026-07-09 | 57af239 |
| PLATFORM-003 | Install doc system: docs/CLAUDE.md constitution, grounding/decisions skeleton, glossary, lean prd/tech/testing snapshots, this pseudo-feature | 2026-07-09 | 8dbbd5a |
| PLATFORM-004 | Create Makefile verbs (setup/dev/build/lint/test) delegating to npm scripts; adapt `.githooks/pre-push`; wire via `make setup` | 2026-07-09 | 3e87876 |
| PLATFORM-005 | Create `.github/workflows/ci.yml` running make build → lint → test on PRs + pushes to main | 2026-07-09 | 3e87876 |
| PLATFORM-006 | Rewrite root CLAUDE.md around the method (~150 lines); write docs/process.md; retire `.claude/commands/execute.md`; verify install (green verbs, hook fires, /decide dry-run, final grep) | 2026-07-09 | 4e69d81 |
