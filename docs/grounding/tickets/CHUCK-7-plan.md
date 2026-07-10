# Ticket Implementation Plan: CHUCK-7 — Add role checks to money-moving SECURITY DEFINER RPCs

**Generated:** 2026-07-09
**Linear:** CHUCK-7 — https://linear.app/blaahd-projects/issue/CHUCK-7/add-role-checks-to-money-moving-security-definer-rpcs
**Branch:** richardblaalid/chuck-7-add-role-checks-to-money-moving-security-definer-rpcs
**Status:** Verified (PLATFORM-011 `e97a1fe`; all ACs pass 2026-07-10)

> **Deviation from plan:** the post-migration `src/types/database.ts` regen was NOT adopted. The fresh generate surfaced **pre-existing dev-DB↔types drift unrelated to this ticket** — most notably the dev database is missing `create_expense_journal_entry` (defined only in `supabase/migrations/archive/20260216000002_expense_journal_rpc.sql`), so adopting the regen breaks `src/app/actions/expenses.ts` compilation; conversely the committed types are stale (missing `debit_funds_from_scout`, `transfer_funds_to_billing`'s `p_allocations`/`p_entry_date`, the `funds_adjustment` enum — see the cast comment at `src/app/actions/funds.ts:107`). This ticket's migration changes no signatures, so the committed types remain correct for it. The reconciliation belongs to PLATFORM-007 (prod/dev schema reconciliation).
**Affects Features:** platform-foundation (finance hardening)
**Epic:** CHUCK-1 — Epic A: Financial Integrity Hardening

## Ticket Summary

Three SECURITY DEFINER RPCs (`transfer_funds_to_billing`, `auto_transfer_overpayment`, `void_payment`) are executable by any logged-in user of any unit via PostgREST and perform zero caller authorization, letting a cross-unit attacker move any scout's funds or void any payment. Add internal authorization assertions (the `user_has_role` pattern the conforming sibling RPCs already use) via a migration, without breaking the legitimate call sites.

## Epic Context

- **Epic:** CHUCK-1 — closes the exploitable holes and enforces ledger invariants from the 2026-07-09 audit; DR-2026-07-09-custom-double-entry-ledger's 4 hardening obligations are its definition of done. Epic sequencing puts this ticket (A-slice "immediately — close the live authz holes") first alongside CHUCK-8.
- **Sibling tickets:** CHUCK-8 (anon `payment_links` read — separate RLS surface), CHUCK-9 (journal balance invariant — obligation 1), CHUCK-10 (finance integration tests — obligation 4), CHUCK-11 (port treasurer paths to transactional RPCs — obligation 2's app-side half), CHUCK-12–16 (validation, webhooks, paid-semantics, reports, clamps). All Todo — nothing in flight collides with this migration.
- **This ticket's boundary:** internal authz checks inside the three named RPCs only. NOT in scope: journal-balance enforcement (CHUCK-9), porting app-layer sequential writes (CHUCK-11), the funds clamp (CHUCK-16), or the full integration-test suite (CHUCK-10 — but this ticket contributes one regression test file, which CHUCK-10 can build on).

## Grounding Extract

- **Decisions implied** — authorization enforced *inside* the RPC (DR obligation 2), not only at the app layer; `user_has_role(unit_id, …)` is the sanctioned pattern (already used by `debit_funds_from_scout`, `credit_fundraising_to_scout`, `void_billing_charge`).
- **New requirements** — cross-unit and insufficient-role callers must be rejected at the database layer regardless of how they reach PostgREST.
- **Technical signals** — migration-based (`CREATE OR REPLACE FUNCTION`); dev Supabase push only; prod push requires explicit approval; regenerate `src/types/database.ts` after (signatures unchanged, expect no diff).
- **Acceptance criteria** — see Verification Plan.

## Analysis Against Existing Docs

- **Relevant architecture:** `docs/features/platform-foundation/architecture.md` points to the DR as the authority for finance hardening.
- **Active DRs that apply:** `DR-2026-07-09-custom-double-entry-ledger-v1` — obligation 2 ("every money-moving mutation is a single transactional RPC that validates caller role/membership internally") is the direct mandate for this ticket.
- **Conflicts detected:** none with DRs. Two **call-site realities the ticket text under-specifies** (surfaced at the gate, resolved in the policy matrix below):
  1. The public **pay-with-balance** route (`src/app/api/payment-links/[token]/pay-with-balance/route.ts:184`) calls `transfer_funds_to_billing` with the **service-role client** (no user session, `auth.uid()` NULL). A bare `user_has_role` check would break this legitimate parent-facing flow. → The checks allow `service_role` callers through (`auth.role() = 'service_role'`); the service key never reaches clients, and server code holding it does its own validation (token validation here). This mirrors the existing `create_refund_journal_entry`/`process_payment_link_payment` service-role grants.
  2. The **use-funds modal** (`src/components/accounts/use-funds-modal.tsx:98`) is rendered for **parents** (`isParent && canUseFunds` in `account-actions.tsx`) and calls `transfer_funds_to_billing` from the browser with the parent's own session. The ticket's done-when explicitly requires this call site to keep working, so `transfer_funds_to_billing` additionally allows a caller who is a **guardian of the affected scout** (`scout_guardians` row). Guardians can only move the scout's own funds toward the scout's own charges (allocations are already validated as scout-owned), so this closes the cross-unit/cross-scout hole while preserving the product flow.
- **Decision-record needed?** No. This implements an existing DR obligation using the existing sanctioned pattern; the guardian clause codifies current shipped product behavior rather than making a new choice. One observation worth a follow-up note (not this ticket): `auto_transfer_overpayment` has **zero callers** anywhere (its logic was inlined into `process_payment_link_payment`) — it gets the strictest check now; dropping it entirely is a candidate for a later cleanup ticket.

### Authorization policy matrix

| RPC | Legitimate callers today | Check added |
|---|---|---|
| `transfer_funds_to_billing` | treasurer quick-payment form (session), parent use-funds modal (session), pay-with-balance route (service role) | `service_role` OR admin/treasurer in the scout's unit OR guardian of the scout |
| `auto_transfer_overpayment` | **none** (dead code — logic inlined in `process_payment_link_payment`) | `service_role` OR admin/treasurer in the scout's unit |
| `void_payment` | `voidPayment` server action (session, pre-checked admin/treasurer) | `service_role` OR admin/treasurer in the payment's unit |

Checks are placed immediately after the affected row is resolved (matching `debit_funds_from_scout`), raising `Permission denied`.

## Task List

Tasks added to `docs/features/platform-foundation/tasks.md` (status "Not Started"), prefix `PLATFORM-`.

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-011 | TDD: add `tests/integration/rpc-authz.test.ts` (cross-unit + insufficient-role callers rejected; treasurer/guardian/service-role callers pass the gate) + migration `20260710000001_rpc_role_checks.sql` recreating the three RPCs with internal authz; push to dev Supabase; regen types (expect no diff). Test-first; single commit because the test can only go green once the shared-dev-DB migration is pushed. | yes | none | AC 1–3 via the new integration tests; AC 2 also via functional smoke (Phase 4) |

One task = one commit: the change is a single migration + a single test file — splitting them would leave a red test committed against the shared dev DB.

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified | Result |
|---|---|---|---|
| 1 | Each RPC raises `Permission denied` for an authenticated caller without admin/treasurer membership in the affected unit (incl. an admin of a *different* unit) | `tests/integration/rpc-authz.test.ts`: ephemeral cross-unit admin + same-unit parent (non-guardian) call each RPC via anon-key session → error | ✅ PASS — 6/6 rejection tests green (all 6 failed pre-migration, proving the hole was live) |
| 2 | Existing legitimate call sites still pass | Integration tests: treasurer, guardian (transfer), and service-role clients pass the authz gate. Functional smoke on :3079 (2026-07-10): parent used Use Scout Funds ($2.50 → billing −27.50→−25.00, funds 81.02→78.52); treasurer voided a cash payment via the payments UI (`voided_at` set) | ✅ PASS — 5/5 acceptance tests green + both browser flows succeeded (screenshots in `CHUCK-7-screenshots/`) |
| 3 | Regression test proves a cross-unit call is rejected | Same test file, committed and green in `make test` locally (skips hermetically in CI without service key, per existing `tests/integration/` pattern) | ✅ PASS — full `make test`: 1246/1246 across 67 files; `make build` green |
| 4 | Dev push only | Dry-run confirmed link to `feownmcpkfugkcivdoal` before `db push`; no prod interaction | ✅ PASS |

## Screenshot Plan

- **Route(s):** `/finances/accounts/[id]` — scout account detail
- **Login:** `richard.blaalid+parent@withcaldera.com` (parent — the strictest legitimate role for the transfer flow); second capture as treasurer for the void action if a voidable payment exists
- **What to capture:** parent completing a Use Scout Funds transfer post-migration (proves the guardian clause preserved the flow), balances updated

## Open Questions

- None blocking. Flagged for follow-up (not this ticket): `auto_transfer_overpayment` is dead code — consider dropping it in a cleanup ticket; `void_payment`'s caller-supplied `p_voided_by` allows attribution spoofing — candidate for deriving from `auth.uid()` internally in a later hardening pass.
