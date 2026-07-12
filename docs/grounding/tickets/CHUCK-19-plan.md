# Ticket Implementation Plan: CHUCK-19 — Add Sentry error tracking; route console.error hot paths through logger (PLATFORM-008)

**Generated:** 2026-07-11
**Linear:** CHUCK-19 — https://linear.app/blaahd-projects/issue/CHUCK-19/add-sentry-error-tracking-route-consoleerror-hot-paths-through-logger
**Branch:** richardblaalid/chuck-19-add-sentry-error-tracking-route-consoleerror-hot-paths (worktree branch: CHUCK-19)
**Status:** Verified (plan approved 2026-07-11; gate answers: no Sentry account yet — build DSN-agnostic, prove capture via Spotlight locally, cloud verification deferred until user creates a project; source-map upload deferred to Vercel; no tunnelRoute)
**Affects Features:** platform-foundation (pseudo-feature)
**Epic:** CHUCK-2 — Epic B: Delivery Infrastructure

## Ticket Summary

Install Sentry across all three runtimes (client, server/actions, edge) so production errors become visible; extend `src/lib/logger.ts` so `.error()` forwards to Sentry; then route the finance-path `console.error` sites — especially the 14 log-and-continue ("swallowed") sites where money moved but a local record silently failed — through the logger so they alert.

## Epic Context

- **Epic:** CHUCK-2 — Epic B: Delivery Infrastructure (CI, monitoring, schema hygiene; audit §3 P0-4).
- **Sibling tickets:** CHUCK-17 (Done — lint/CI unblock, PLATFORM-012), CHUCK-18 (Todo — prod-schema reconciliation, PLATFORM-007), CHUCK-20 (Todo — integration-test split, PLATFORM-009), CHUCK-21 (Todo — typecheck tests + coverage, PLATFORM-010).
- **This ticket's boundary:** error monitoring only (PLATFORM-008, Phase 1 lane-A). No test-config changes (CHUCK-20/21 own those), no schema work (CHUCK-18), no control-flow changes to the payment paths — swallowed sites keep their deliberate continue-behavior but become visible.

## Grounding Extract

- **Decisions implied** — Sentry is the error-monitoring vendor (already committed by the Phase-0 roadmap checklist and the 2026-07-09 audit P0-4; the ticket executes, not chooses). `src/lib/logger.ts` becomes the enforced path for error logging in finance code.
- **New requirements** — (1) client, server-action, and API-route errors reach Sentry with release + user context; (2) the finance-path swallowed-error sites alert instead of dying in stdout; (3) integration is a safe no-op when no DSN is configured (dev default, tests, CI).
- **Technical signals** — Next.js 16 App Router on Turbopack (`next build` default): use `@sentry/nextjs` manual setup — `src/instrumentation.ts` (+ `onRequestError = Sentry.captureRequestError`), `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `withSentryConfig` around `next.config.mjs`. `excludeServerRoutes` unsupported on Turbopack. TODO markers exist at `src/app/(dashboard)/error.tsx:19` and `src/app/global-error.tsx:17`. `.env.local.example` already stubs `SENTRY_DSN`.
- **Design signals** — none; no UI changes beyond invisible captures in the existing error boundaries.
- **Acceptance criteria** — see Verification Plan (mirrors ticket done-when).

### Audit of the target console.error sites (2026-07-11 sweep)

47 `console.error` sites across 15 finance files; **none import `@/lib/logger`**. 14 are SWALLOWED (log-and-continue). Highest severity:

| Site | What silently fails |
|---|---|
| `api/square/payments/route.ts:293,316,341` | Square charge captured; journal lines / payment record / allocations insert fails — route still returns success |
| `api/payment-links/[token]/pay-with-balance/route.ts:216` | funds transfer committed; payment row missing |
| `api/square/webhooks/route.ts:145,271` | webhook processing / refund journal entry dropped (route returns 200 to stop Square retries) |
| `app/actions/expenses.ts:520,525` | expense approved; expense journal entry not created |
| `app/actions/payments.ts:242` | allocations insert fails after payment recorded |
| `lib/square/sync.ts:105,140` | order/customer enrichment skipped during sync |
| `api/payment-links/route.ts:257` | payment-request email send fails; link created silently unsent |
| `app/pay/[token]/page.tsx:224,237` | Square card SDK init/cleanup failures (client) |

The other 33 sites are PROPAGATED (error response returned) — they still migrate to `logger` for Sentry visibility, but they're lower risk.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/` capability 5 ("error monitoring … tracked here until done"); PLATFORM-008 in that feature's tasks.md is this exact work — this plan **decomposes PLATFORM-008 into PLATFORM-015…018**. (Originally claimed as 013…016; on merging `main`, 013/014 collided with parallel claims by CHUCK-20/CHUCK-8, so the Sentry-install task became 017 and the boundaries task 018 — commits and older comments reference the original IDs. The logger task 015 and migration task 016 kept their IDs.)
- **Active DRs that apply:** DR-2026-07-09-custom-double-entry-ledger-v1 — its hardening obligations motivate alerting on the money-moving swallows; nothing in this ticket touches ledger semantics.
- **Conflicts detected:** none. One scope note: the ticket cites "352 console statements repo-wide" as context, but its build scope is the *finance-path* sites only — this plan does not touch the other ~305 statements.
- **Decision-record needed?** No. Vendor choice (Sentry) was made in the roadmap/audit; everything else is mechanical integration. `docs/tech.md` stack list gets a direct-edit line for Sentry (uncontroversial factual update).

## Task List

Added to `docs/features/platform-foundation/tasks.md` (next free ID was PLATFORM-013 at plan time; PLATFORM-008 marked as decomposed into these). **Post-merge IDs:** PLATFORM-013→017, PLATFORM-014→018 (collision renumber); 015/016 unchanged:

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-013 | Install `@sentry/nextjs`; create `src/instrumentation.ts` (register + `onRequestError`), `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`; wrap `next.config.mjs` in `withSentryConfig`; env plumbing (`NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN`, no-op when unset); update `.env.local.example`; add Sentry to `docs/tech.md` stack line | no | none | `make build` green with and without DSN; dev server boots |
| PLATFORM-014 | Wire error boundaries + context: `Sentry.captureException` in `(dashboard)/error.tsx` + `global-error.tsx` (retire TODOs); client user context (`Sentry.setUser` from the authenticated session in the dashboard layout); release + environment on all three inits | no | PLATFORM-013 | forced dev exception appears in Sentry with release + user context |
| PLATFORM-015 | Extend `src/lib/logger.ts`: `.error()` forwards to Sentry (`captureException` for Error data, `captureMessage` otherwise) with namespace tag + data context; keep console behavior; unit tests with mocked `@sentry/nextjs` | yes | PLATFORM-013 | new vitest file green; suite green |
| PLATFORM-016 | Route the 47 finance-path `console.error` sites (15 files: `api/square/**`, `api/payment-links/**`, `actions/{payments,expenses,reconcile}.ts`, `lib/square/sync.ts`, `pay/[token]/page.tsx`) through `logger.*.error`; no control-flow changes | no | PLATFORM-015 | `grep -r console.error` over those files → 0; lint + typecheck + suite green |

## Verification Plan (AC → observable check)

No cloud DSN exists yet (gate answer: no Sentry account), so "visible in Sentry" was proven against Sentry's official local Spotlight sidecar — same SDK, same envelopes, no DSN. Cloud-side re-verification is a 2-minute step once a DSN exists (see Open Questions).

| # | Acceptance criterion (ticket done-when) | How it's verified | Result (2026-07-11) |
|---|---|---|---|
| 1 | Forced dev exception visible in Sentry with release + user context | logged in as treasurer on :3016, threw a render error in a temporary dashboard page → `(dashboard)/error.tsx` boundary → event in Spotlight; envelope intercepted and inspected | ✅ PASS — event carries `user: {id: 28666619…, email: richard.blaalid+treasurer@…}`, `release: 9536c70`, `environment: development`, tags `role: treasurer`, `unit_id: 1000…0001` (`sentry-issue-forced-error.png`, `forced-error-context.png`) |
| 2 | Swallowed-error sites in the payment paths alert | exercised the exact server pipe all 48 sites use (`logger.payment.error(msg, Error)`) via a temporary route; envelope captured from the sidecar SSE stream | ✅ PASS — event carries `logger: Payment` tag, `release: 9536c70`, formatted message in extra, Error as exception (`sentry-issue-swallowed-path.png`, `swallowed-path-context.png`) |
| 3 | Build green | full gate after all commits: `make build` exit 0, `make lint` exit 0, `make test` exit 0 | ✅ PASS — identical to the green pre-work baseline (no new failures) |
| 4 | No-DSN safety (implied) | `make test` + `make build` run with zero Sentry env vars configured | ✅ PASS — SDK no-ops; suite and build green |

Temporary verification artifacts (`sentry-verify` page, `dev-sentry-logger-test` route, driver scripts) were deleted after the run — nothing synthetic is committed.

## Screenshot Plan

- **What to capture:** the Sentry issue page (browser) showing the forced exception with release + user context → `docs/grounding/tickets/CHUCK-19-screenshots/sentry-issue.png`; plus the app's error boundary rendering during the forced error for context.
- **Route(s):** `/dashboard` (forced error) on `http://localhost:3016`; Sentry web UI for the evidence shot.
- **Login:** treasurer test user (`richard.blaalid+treasurer@withcaldera.com`) — finance ACs verified as a finance role.

## Open Questions — resolved at the gate (2026-07-11)

1. **Sentry DSN:** user has no Sentry account. Built DSN-agnostic; local capture proven via Spotlight. **Remaining user action to go live:** create a free Sentry account/project (sentry.io → Create Project → Next.js), then set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` to the project DSN in `.env.local` (dev) and the Vercel environment (prod). No code change needed; re-verify by repeating the forced-exception check.
2. **Source-map upload:** deferred to Vercel prod env (`SENTRY_AUTH_TOKEN` + org/project in `withSentryConfig` later). Local/CI builds run without upload.
3. **Tunnel route:** skipped for the pilot.
