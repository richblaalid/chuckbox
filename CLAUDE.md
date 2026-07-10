# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chuckbox — the "Unit Operating System" for Scouting America units (troops, packs, crews): scout-account fund accounting (double-entry), fair-share billing, Square payments, roster, expenses, and Scoutbook sync via a browser extension. In private pilot with a single troop; **real money flows in production**. Product snapshot: `docs/prd.md`. Technical snapshot: `docs/tech.md`.

## Commands

| Command | Description |
|---------|-------------|
| `make setup` | One-time: wire git hooks (`.githooks/` — pre-commit lint, pre-push build gate) |
| `make dev` | Next.js dev server on :3000 (`make dev OFFSET=N` → :300N for parallel worktrees) |
| `make build` | Next.js production build — the type gate; fails loudly on type errors |
| `make lint` | ESLint 9 flat config (incl. custom `no-single-on-unit-memberships` rule) |
| `make test` | `npx vitest run` (run mode — `npm test` alone watches in a TTY) |

Single test file: `npx vitest run tests/unit/utils.test.ts` · E2E: `npm run test:e2e`

**Dev-server restart (port-specific — never `pkill next dev`):** `lsof -ti:3000 | xargs kill 2>/dev/null; make dev`

**Database dev tools** (`npm run db:*`): `db:reset` / `db:seed:base|test|all` / `db:fresh` (reset+seed+fix+validate) / `db:dump [-- name]` / `db:restore -- <file>` / `db:validate`. All worktrees share the ONE dev Supabase database — never run destructive db scripts while a parallel run is active.

**Test users** (password `testpassword123`): `richard.blaalid+{admin,treasurer,leader,parent,scout}@withcaldera.com` — one per role.

## Supabase Environments — CRITICAL

| Env | Project ref | Rule |
|---|---|---|
| Dev | `feownmcpkfugkcivdoal` | Default for all migrations (`supabase link` here first) |
| Prod | `jtzidlmxrorbjnygfvvp` | **Never push without explicit user approval** |

Check `supabase projects list` before any `db push`. After a migration, regenerate `src/types/database.ts` before writing dependent code, and remind the user to reload the schema cache (Dashboard → Settings → API).

## Architecture

- **Next.js 16** (App Router, React 19) + **Supabase** (PostgreSQL/RLS, magic-link auth) + Tailwind 4/shadcn/ui + Vitest 4 + Playwright
- Route groups: `src/app/(auth)/`, `(dashboard)/` (protected), `(marketing)/`, `pay/[token]` (public payment page)
- Mutations: server actions in `src/app/actions/`; API routes in `src/app/api/` (webhooks, OAuth, extension, and legacy paths)
- Domain logic: `src/lib/` — `payment-allocation.ts` (allocation engine), `billing.ts`, `square/`, `plaid/`, `email/`, `sync/scoutbook/`, `expenses/`, `encryption.ts`
- Supabase clients: `src/lib/supabase/server.ts` (Server Components), `client.ts` (browser), `admin.ts` (service role — bypasses RLS; every use needs its own authz check)
- Generated DB types: `src/types/database.ts` — never hand-write row/insert shapes
- Scout accounts are **dual-balance**: `billing_balance` (charges owed; negative = owes) + `funds_balance` (scout savings; ≥ 0) — see `docs/glossary.md`

## Key Patterns

**Multi-unit auth** — a user can belong to multiple units; three sanctioned patterns:
1. *Cookie-driven* (pages/actions on current page): `getCurrentMembership()` from `@/lib/data/cached-queries`
2. *Body-validating* (caller names a unit): pass the body's `unitId` to the helper AND verify `membership.unit_id === unitId`
3. *Resource-scoped* (acting on a row): fetch the resource, call the helper with its `unit_id`, verify equality

**Feature flags** (`src/lib/feature-flags.ts`): env-var based, render-time (refresh, not rebuild). `ADVANCEMENT_TRACKING`, `MULTI_UNIT_CREATION`, `BANK_INTEGRATION` all default off.

**PostgREST limits**: `.in()` with 200+ UUIDs exceeds URL limits → batch at 100. Default 1,000-row response cap → paginate report queries. One-to-one relations return objects, not arrays.

**BSA reference data**: single source of truth `data/bsa-data-canonical-normalized.json`; seeders in `scripts/` validate counts and fail loudly. Never reduce data quality in seeders; test with `npm run db:fresh`. See `data/README.md`.

**Push gate**: `make setup` enables `.githooks/pre-push` (per-repo, opt-in) — runs `make build` before any push. Bypass with `--no-verify` only in genuine emergencies.

## Documentation System

This project uses a structured documentation pipeline. Read `docs/CLAUDE.md` for doc system rules, templates, and update flows; `docs/process.md` for process conventions.

- `/ground` — Process raw signal (feedback, transcripts, specs) through the grounding pipeline into structured extracts and doc updates
- `/decide` — Draft a Decision Record with impact analysis and downstream doc updates
- `/execute` — Iterate through tasks in a feature's `tasks.md`, running build/lint/simplify/test/commit per task
- `/implement` — Take a Linear ticket (CHUCK-N) end-to-end: ground → plan gate → execute → verify ACs → PR
- `/qa` — Triage a QA-feedback batch, reproduce, fix through the validated loop, one ticket per defect
- `/epic-progress` — Per-epic %-complete from Linear (`epic:*` labels) · `/presentation` — recurring product-update slides

**Load `docs/glossary.md` before processing any product/technical/requirements documents** — Scouting/BSA and fund-accounting terminology has critical distinctions (billing_balance vs funds_balance, rank vs merit-badge requirements, unit vs troop/pack).

Legacy planning artifacts (`plans/`, `docs/superpowers/specs/`) are **read-only history** — new work enters via `/ground` → `docs/features/*`; migrate a legacy spec's content through `/ground` when you pick it up.

## Conventions

- Documentation targets ~400 lines per file; decompose into feature modules when exceeded
- Only current decision-record versions live in the tree; superseded versions are deleted (git preserves history)
- All product knowledge enters through the `/ground` pipeline, not ad-hoc edits
- CI (`.github/workflows/ci.yml`) runs `make build` → `make lint` → `make test` on every PR and push to main — identical to the local verbs
- Linear: team **Chuckbox** (prefix `CHUCK`), project **Chuckbox**; epics = `epic:*` labels with container issues titled `Epic [A-Z] — …`
- Verification before completion: no "done" claims without fresh green output from the make verbs; prove ACs against the running app (`http://localhost:3000`+OFFSET) as the role the AC implicates
- TDD for business logic (failing test first — Vitest + RTL); build-and-smoke for infrastructure
- No `any` types; match existing patterns; no nested ternaries; prefer editing existing files over creating new ones
- Avoid reading localStorage in initial state (hydration); no nested interactive elements (use `<div role="button">`)
- Commits: `[type]([scope]): [TASK-ID] [imperative description]`
