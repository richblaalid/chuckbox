# Ticket Implementation Plan: CHUCK-8 — Close anonymous read of payment_links (token harvesting)

**Generated:** 2026-07-11
**Linear:** CHUCK-8 — https://linear.app/blaahd-projects/issue/CHUCK-8/close-anonymous-read-of-payment-links-token-harvesting
**Branch:** richardblaalid/chuck-8-close-anonymous-read-of-payment_links-token-harvesting
**Status:** Verified (PLATFORM-013 `8b4bd6a`; all ACs pass 2026-07-11)
**Affects Features:** platform-foundation (finance hardening)
**Epic:** CHUCK-1 — Epic A: Financial Integrity Hardening

## Ticket Summary

The `payment_links` table carries a `FOR SELECT USING (true)` policy with no role restriction (`schema.sql:1430-1431`); combined with the blanket `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon` (`schema.sql:2403`), any client holding the public anon key can dump every payment link — tokens, amounts, scout_account_ids — defeating token secrecy on the public `/pay/[token]` flow. Drop the policy, revoke the anon table grants (nothing in the app uses them), and prove the pay flow still works.

## Epic Context

- **Epic:** CHUCK-1 — closes the exploitable holes from the 2026-07-09 audit; DR-2026-07-09-custom-double-entry-ledger's hardening obligations are the definition of done. Epic sequencing puts this ticket in the "immediately — close the live authz holes" slice alongside CHUCK-7 (now Done).
- **Sibling tickets:** CHUCK-7 — Done — internal role checks on the three money-moving RPCs; established the migration + `tests/integration/` TDD pattern (PLATFORM-011) this ticket follows. CHUCK-9–16 — Todo — journal invariant, integration-test suite, transactional ports, webhook/validation hardening; none touch RLS policies or grants.
- **This ticket's boundary:** the `payment_links` SELECT policy and the schema-wide **anon** grants only. NOT in scope: `authenticated`-role grants (RLS policies gate those), function-EXECUTE exposure to anon (noted in audit findings as follow-up), the funds clamp / journal invariant (CHUCK-16 / CHUCK-9).

## Grounding Extract

- **Decisions implied** — anonymous PostgREST access to `payment_links` is never legitimate: the public pay flow resolves tokens server-side with the service client; token lookup must not be possible with the anon key.
- **New requirements** — the anon role must not be able to read (or write) any `public` schema table; the public `/pay/[token]` flow must be unaffected.
- **Technical signals** — migration-based; dev Supabase push only (prod needs explicit approval); types regen expected to be a no-op (no signature/shape changes; CHUCK-7 documented pre-existing dev↔types drift that makes adopting a fresh regen wrong).
- **Acceptance criteria** — see Verification Plan.

## Audit: what the blanket anon grant exposes (ticket's "while in there" ask)

Verified findings, 2026-07-11:

1. **All tables have RLS enabled** — diffed every `CREATE TABLE` against `ENABLE ROW LEVEL SECURITY` across the migration chain: zero tables without RLS.
2. **Policies reachable by anon:** only two policies apply to the anon role — the target `"Anyone can view payment links by token"` (SELECT, no `TO` clause → all roles) and `"Allow public waitlist submissions"` (INSERT `TO anon` on `waitlist`). Every other `USING (true)` policy is scoped `TO authenticated` (BSA reference data).
3. **Nothing in the app uses anon table access.** The `/pay/[token]` page fetches only its API routes; those routes use `createServiceClient()`. The waitlist form posts to `/api/waitlist`, which uses the service-role key. The browser Supabase client is only exercised by authenticated sessions (→ `authenticated` role). The Scoutbook extension talks to API routes. The explicit `GRANT SELECT ... TO anon` on five `bsa_*` tables (`schema.sql:4094-4098`) is already **inert** — their policies are `TO authenticated`, so anon gets zero rows today.
4. **The real hazard is the class, not the instance:** with the blanket grant in place, any future policy written without a `TO` clause instantly exposes its table to the anon key — exactly how `payment_links` leaked. Revoking anon's table/sequence privileges closes the class.
5. **Follow-up (out of scope, flagged):** Postgres grants EXECUTE on functions to PUBLIC by default, so anon can *call* RPCs; CHUCK-7's internal role checks make the money-movers reject such calls, but a broader function-grant audit is a candidate follow-up ticket.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/` (finance hardening lives here; architecture.md defers to the DR).
- **Active DRs that apply:** `DR-2026-07-09-custom-double-entry-ledger-v1` — obligation 2's spirit (authorization enforced at the database layer, not only in app code) motivates closing DB-level read exposure.
- **Conflicts detected:** none. The ticket's own note ("pay routes use the service client — dropping should be behavior-neutral") is verified correct.
- **Decision-record needed?** No. Dropping an unused, exploitable policy and unused grants implements the audit finding with no meaningful alternative worth recording. One gate-level choice to confirm (see Open Questions): whether to also `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon` so future tables don't re-acquire anon grants automatically. Recommended: yes — same hazard class, one line, reversible.

## Planned Migration (single file, `20260711000001_close_anon_payment_links_read.sql`)

1. `DROP POLICY "Anyone can view payment links by token" ON payment_links;` — closes P0-3 directly; the leaders/parents/treasurers SELECT policies remain for authenticated users.
2. `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` and `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;` — defense in depth; verified zero app dependencies. (Schema `USAGE` for anon is kept — harmless without table privileges, and expected by PostgREST.)
3. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;` (+ sequences) — future tables no longer auto-grant to anon (pending gate confirmation).

The `waitlist` anon INSERT policy becomes inert (policy stays, grant gone) — the live form uses the service-role route; documented here for the future reader.

## Task List

Tasks added to `docs/features/platform-foundation/tasks.md` (status "Not Started"), prefix `PLATFORM-`.

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-013 | TDD: add `tests/integration/payment-links-anon.test.ts` (anon key cannot read a seeded payment link — by dump or by exact token — nor other sensitive tables; treasurer/guardian policies and the service client still read) + migration `20260711000001_close_anon_payment_links_read.sql` dropping the anon-readable policy and revoking the blanket anon table/sequence grants; push to dev Supabase | yes | none | AC 1–2 via the new integration tests; AC 2 also via functional pay-flow smoke (Phase 4) |

One task = one commit (same rationale as PLATFORM-011: the test can only go green once the shared-dev-DB migration is pushed; splitting would commit a red test).

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified | Result |
|---|---|---|---|
| 1 | `GET /rest/v1/payment_links?select=*` with the anon key returns zero rows (a seeded link does not leak, by dump or by exact-token filter) | `tests/integration/payment-links-anon.test.ts`: seed a link via service client, assert the anon client sees nothing; also assert anon reads of `payments`, `scout_accounts`, `profiles` leak nothing (blanket-revoke check) | ✅ PASS — pre-migration the anon key dumped 16 rows and resolved the seeded token (both tests red, hole proven live); post-push 7/7 green; raw curl now returns HTTP 401, zero rows |
| 2 | The `/pay/[token]` flow still works end-to-end (verified as parent role) | Integration tests: treasurer + guardian sessions still read links; service client still resolves by token. Functional smoke on :3055 (2026-07-11): parent session loaded `/pay/[token]` for a fresh $25 link on Ben B., paid with Scout Funds — success screen, billing_balance −25→0, funds_balance 78.52→53.52 (screenshots in `CHUCK-8-screenshots/`) | ✅ PASS — 3/3 legitimate-reader tests green + browser flow succeeded |
| 3 | Dev push only | `supabase projects list` link check before `db push`; no prod interaction | ✅ PASS — linked to `feownmcpkfugkcivdoal` (chuckbox-dev) before push |

Full gate 2026-07-11: `make build` green; `make test` 1253/1253 across 68 files (baseline `implement-baseline.log` was green; the +7 tests are this ticket's).

**Observation (pre-existing, not this ticket):** a fully-funds-paid link keeps `status='pending'` with `payment_id` set (balances settle correctly). Candidate note for the parked void/delete-billing UX work.

## Screenshot Plan

- **Route(s):** `/pay/[token]` — the public payment page
- **Login:** `richard.blaalid+parent@withcaldera.com` (parent — the role the done-when names for the pay flow)
- **What to capture:** the payment page rendering the seeded link's details post-migration (proves token resolution via the service client survived the lockdown)

## Open Questions

- Confirm at the gate: include the `ALTER DEFAULT PRIVILEGES` line (item 3 of the migration) so future tables don't silently re-grant to anon? Recommended yes; omitting it still satisfies the ticket's done-when.
