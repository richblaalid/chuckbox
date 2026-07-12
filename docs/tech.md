# Chuckbox — Technical Snapshot

**Status:** honest snapshot as of 2026-07-09 (method adoption). ~90k source lines, 427 TS/TSX files. Deep-dive findings: `reports/2026-07-09-chuckbox-current-state-audit.md`.

## Stack

- **Next.js 16** (App Router, React 19), TypeScript strict, Tailwind 4 + shadcn/ui
- **Supabase** (PostgreSQL + RLS, Auth via magic links, generated types in `src/types/database.ts`)
- **Vitest 4** + React Testing Library; Playwright e2e (smoke)
- **Integrations:** Square (payments, OAuth per unit), Plaid (gated), Resend (email), Anthropic SDK (receipt OCR + Scoutbook roster parsing), PostHog (partial), Sentry (`@sentry/nextjs` — client/server/edge error monitoring; no-op without `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`; `src/lib/logger.ts` `.error()` forwards to it)
- **Hosting:** Vercel (app) + Supabase (backend)

## Environments — CRITICAL

| Env | Supabase ref | Rule |
|---|---|---|
| Dev | `feownmcpkfugkcivdoal` | Default target for all migrations |
| Prod | `jtzidlmxrorbjnygfvvp` | **Never push without explicit user approval** |

All git worktrees share the ONE dev database. Destructive db scripts (`db:reset`, `db:fresh`, `db:restore`) must never run while a parallel run is active. Known debt: prod schema was historically patched via hand-run SQL (`supabase/scripts/`); reconciliation is a platform-foundation task.

## Architecture shape

- `src/app/(auth)/`, `(dashboard)/`, `(marketing)/`, `pay/[token]` route groups; middleware handles session refresh + redirects
- **Mutations:** split between server actions (`src/app/actions/`, 14 modules) and API routes (`src/app/api/`, 47 routes) — historical, not principled; external callbacks (webhooks, OAuth, extension) genuinely need routes
- **Data layer:** `src/lib/data/cached-queries.ts` is thin; most pages query Supabase inline (known debt)
- **Domain logic:** `src/lib/` — `payment-allocation.ts` (the model module), `billing.ts`, `square/`, `plaid/`, `email/`, `sync/scoutbook/`, `expenses/`, `encryption.ts` (AES-256-GCM)
- **DB functions:** money movement increasingly lives in SECURITY DEFINER RPCs; `process_payment_link_payment` (atomic, `FOR UPDATE`) is the model — several older RPCs lack internal role checks (audit P0)

## Auth patterns (multi-unit)

Three sanctioned patterns (root `CLAUDE.md` has the table): cookie-driven (`getCurrentMembership()`), body-validating (pass `unitId` + verify equality), resource-scoped (fetch row, use its `unit_id`, verify). Custom ESLint rule `custom/no-single-on-unit-memberships` guards a past bug class. Known debt: two divergent `getCurrentMembership` implementations; 22 files use the RLS-bypassing admin client with hand-rolled checks.

## Feature flags

Env-var based, render-time (`src/lib/feature-flags.ts`): `ADVANCEMENT_TRACKING` (off), `MULTI_UNIT_CREATION` (off), `BANK_INTEGRATION` (off), `SCOUTBOOK_SYNC` (dead flag — checked nowhere), `CLI_AUTOMATION` (off, dev-only).

## Sharp edges (carry into any plan)

- PostgREST `.in()` with 200+ UUIDs exceeds URL limits — batch at 100 (root `CLAUDE.md` has the pattern)
- Supabase one-to-one relations return objects, not arrays
- Reports queries hit PostgREST's 1,000-row default cap — paginate
- Dollars-as-floats in JS layer; DB is `DECIMAL(10,2)`; allocation tolerance 0.01
- Feature flags need dev-server env at boot + page refresh
- Migration changes must regen `src/types/database.ts` before dependent code (`/implement` "types ordering exception")

## Active DR index

DRs live in `docs/decisions/` (see `docs/CLAUDE.md` for template/supersession rules).

| DR | Topic |
|---|---|
| [DR-2026-07-09-custom-double-entry-ledger-v1](decisions/DR-2026-07-09-custom-double-entry-ledger-v1.md) | Postgres-native ledger (not Medici); binds 4 hardening obligations on all money-moving code |

Further retroactive-DR candidates: dual-balance model, extension AI-parsing.
