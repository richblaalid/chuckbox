# Ticket Implementation Plan: CHUCK-9 — Enforce journal balance invariant; fix the unbalanced writers; repair history

**Generated:** 2026-07-12
**Linear:** CHUCK-9 — https://linear.app/blaahd-projects/issue/CHUCK-9/enforce-journal-balance-invariant-fix-the-two-unbalanced-writers
**Branch:** richardblaalid/chuck-9-enforce-journal-balance-invariant-fix-the-two-unbalanced
**Status:** Approved (gate passed 2026-07-12: scope expansion, 3000 OBE contra, 5600 surcharge contra, negative-equity artifact all approved)
**Affects Features:** platform-foundation (finance-hardening group, precedent: CHUCK-7/CHUCK-8)
**Epic:** CHUCK-1 — Epic A: Financial Integrity Hardening

## Ticket Summary

Ship DR obligation 1: a database-level constraint (deferred constraint trigger) enforcing Σdebit = Σcredit per journal entry, fix every live writer that produces unbalanced entries, and run a one-time repair of historical unbalanced entries — the constraint must land in the same migration as the repair or it blocks legitimate writes and voids of historical entries.

## Epic Context

- **Epic:** CHUCK-1 — closes the P0/P1 financial-correctness holes from the 2026-07-09 audit before feature work resumes. Sequencing: A1/A2 (done) → **A3 (this ticket)** / A4 → A5–A9.
- **Sibling tickets:**
  - CHUCK-7 — Done — RPC role checks (`20260710000001_rpc_role_checks.sql` now holds the latest `void_payment`/`transfer_funds_to_billing`/`auto_transfer_overpayment` — all balanced writers).
  - CHUCK-8 — Done — closed anon `payment_links` read.
  - CHUCK-10 — Todo — finance integration tests (15-test spec). This ticket ships the journal-balance subset only; CHUCK-10 builds the rest on the harness this ticket extends.
  - CHUCK-12 — Todo — fee-alignment spec on `/api/square/payments` (`baseAmountCents` rename, `pass_fees_to_payer` read, removal of the RPC's inline overpayment sweep). **Not touched here** — this ticket only makes that route's line-insert failure loud. Note: the approved fee-alignment spec's journal table inherits the same missing-surcharge-credit bug this ticket fixes in the RPC; when CHUCK-12 "adapts lines 2267-2289", it must adapt the **fixed** version.
  - CHUCK-11 — Todo — ports `reconcileSquareTransaction`/`recordQuickPayment` to single transactional RPCs. This ticket fixes reconcile's *line math* in place; CHUCK-11 later moves the (now-balanced) logic into an RPC.
  - CHUCK-16 — Todo — owns the `GREATEST(0,…)` clamps; untouched here.
- **This ticket's boundary:** the balance invariant (constraint + writer line-math fixes + data repair). No transactionalization (CHUCK-11), no fee-model alignment (CHUCK-12), no clamp removal (CHUCK-16), no full test spec (CHUCK-10).

## Grounding Extract

- **Decisions implied** — DB-level enforcement via `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` on `journal_lines`; repair ships in the same migration, before trigger creation; dev push only (prod repair+constraint needs separate explicit approval).
- **New requirements** — No transaction may commit leaving a journal entry with Σdebit ≠ Σcredit; the two named writers (+ one more found in grounding, below) write balanced entries; `/api/square/payments` surfaces `journal_lines` insert failure instead of swallowing it.
- **Technical signals** — `validate_journal_entry_balance()` exists (`schema.sql:1098`) but is attached to nothing (confirmed). All 8 TypeScript writers insert `journal_entries` and `journal_lines` in separate PostgREST transactions — the constraint trigger must therefore fire **on `journal_lines`** (an entry-only transaction touches no lines, so it commits; every lines-transaction must balance its entries). All SQL RPCs are single-transaction and safe. No code path UPDATEs or DELETEs individual `journal_lines`.
- **Acceptance criteria** — see Verification Plan.

### Grounding findings beyond the ticket text (dev-DB diagnostic, 2026-07-12)

64 unbalanced entries in dev (202 entries total, 0 zero-line entries):

| Class | Count | Shape | Gap |
|---|---|---|---|
| `beginning_balance` imports (`/api/import/balances`) | 57 | **single-sided** lines (1100 receivable and/or 2100 funds-liability), no contra | −$15,344 across 2 units |
| `balance_import_reversal` (undo route) | 1 | mirror of the above | +$60 |
| Reconcile card payments (`reconcile.ts`) | 5 | debit bank net, credit gross, **no fee line** | −$6.56 (= Σ fees) |
| Payment-link, fees-passed (`process_payment_link_payment`) | 1 | debits gross, credits base only, **no surcharge credit** | +$0.42 (= surcharge) |

Trial balance before repair: unit `a2727…` out by **−$15,372.20**, unit `1000…0001` (seed) out by **−$767.90** (snapshots captured, will be committed with the repair).

⚠️ **Scope deviation vs ticket text:** the audit's "two unbalanced writers" is incomplete — `/api/import/balances` (and its undo) is a **third live unbalanced writer**, by design (beginning-balance import with no balancing line). The constraint cannot ship without fixing it and repairing its 58 historical entries. Fix: introduce an **Opening Balance Equity** system account (`3000`, type `equity` — the enum already supports it) as the contra for balance imports, the standard bookkeeping treatment for imported opening balances.

Full writer audit (all other writers verified balanced): `voidBillingRecord`, `recordQuickPayment`, charges import + void, balances undo (mirror), `payment-entry.tsx` manual tab, seed scripts, and all money RPCs post-CHUCK-7. One conditional: `create_billing_with_journal` is balanced only if the caller passes `total = count × per_scout`; the constraint will (correctly) reject inconsistent calls — no code change needed here.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/` (finance-hardening group); `docs/testing.md` money-edge-case obligations.
- **Active DRs that apply:** `DR-2026-07-09-custom-double-entry-ledger-v1` — obligation 1 (**enforce** the invariant) is this ticket; its Risks section mandates the repair-with-constraint pairing this plan implements. Obligation 4 (DB-level integration tests) partially satisfied here (journal-balance subset), completed by CHUCK-10.
- **Conflicts detected:** none with active DRs. The legacy fee-alignment spec (CHUCK-12's input) restates the unbalanced fees-passed line shape as if correct — flagged above for CHUCK-12, no doc edit here (legacy specs are read-only history).
- **Decision-record needed?** Two small bookkeeping conventions are introduced (flagged at the gate, recommendation: approve inline, record both as a v2 changelog entry on the ledger DR in this ticket's docs commit):
  1. **Opening Balance Equity (`3000`)** as the contra account for balance imports/reversals — standard accounting treatment; alternative (income account) misstates income.
  2. **Payer surcharge credited to `5600` Payment Processing Fees** (contra-expense) in the fees-passed branch — nets fee expense to (Square fee − collected surcharge) ≈ 0, matching the spec's "customer paid the fee" framing; alternative (new income account) grosses up both sides.

## Task List

Added to `docs/features/platform-foundation/tasks.md` (IDs PLATFORM-021…026 claimed; next free: 027).

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-021 | Fix `reconcileSquareTransaction`: add `5600` fee-expense debit line (fail with clear error if 5600 missing while fee > 0) — extend `tests/unit/actions/reconcile.test.ts` | yes | none | AC-2 |
| PLATFORM-022 | Migration `opening_balance_equity_account`: add `3000 Opening Balance Equity` (system, type `equity`) to `create_default_accounts` + backfill for existing units; fix `/api/import/balances` + its undo route to write the contra equity line — new unit tests | yes | none | AC-2 |
| PLATFORM-023 | Migration `fix_payment_link_fee_balance`: `process_payment_link_payment` fees-passed branch credits `5600` for the surcharge (total − base); RAISE if fee account missing while a fee line is due (both branches) | no (int. test in 026) | 022 | AC-2 |
| PLATFORM-024 | `/api/square/payments`: on `journal_lines` insert failure, delete the orphan journal entry and return 500 with `squarePaymentId` (no more silent continue) — extend `tests/unit/api/square-payments.test.ts` | yes | none | AC-2 |
| PLATFORM-025 | Migration `journal_balance_repair_and_constraint`: targeted repair passes (imports→3000, reconcile→5600 debit, fees-passed→5600 credit), fail-loud guard if any entry remains unbalanced, then `CREATE CONSTRAINT TRIGGER` (deferred) on `journal_lines`; push to dev; commit before/after trial-balance snapshots | no | 021,022,023,024 | AC-1, AC-3 |
| PLATFORM-026 | Integration tests `tests/integration/journal-balance.test.ts`: unbalanced line-set insert rejected at commit; balanced accepted; `process_payment_link_payment` produces balanced entries in both fee modes; balances-import line shape balances | yes | 025 | AC-1, AC-2 |

Migration-bearing tasks (022, 023, 025) push to **dev only** (`feownmcpkfugkcivdoal`), sequenced before their consumers; types regenerated after each push (no table-shape changes expected — data + functions only). No destructive db scripts at any point.

## Verification Plan (AC → observable check)

| # | Acceptance criterion (from ticket "Done-when") | How it's verified |
|---|---|---|
| 1 | Constraint active in dev: no transaction can commit an unbalanced journal entry | Integration test: single-transaction unbalanced `journal_lines` insert via service client → rejected with the balance error; balanced insert → commits |
| 2 | Both (all three) writers produce balanced entries per charge/fee mode | Unit tests: reconcile scout + not-scout modes assert 3-line balanced insert; square-payments route failure path. Integration tests: `process_payment_link_payment` fees-passed and fees-absorbed both yield Σdebit=Σcredit; import contra-line shape balances. (Reconcile is a cookie-authed server action — its line math is unit-verified; the constraint enforces it at runtime.) |
| 3 | Repair run; before/after trial balance documented | Trial-balance script output committed alongside this plan: before = units out by −15,372.20 / −767.90; after = both units tie out (Σdebit = Σcredit) |
| 4 | Balance-sheet report ties out | Browser as **treasurer** on `http://localhost:3021/finances/reports`: Assets = Liabilities + Equity + Net Income; screenshot evidence |

## Screenshot Plan

- **Route(s):** `/finances/reports` (balance sheet) on `http://localhost:3021`
- **Login:** `richard.blaalid+treasurer@withcaldera.com` (reports access requires treasurer/admin)
- **What to capture:** balance sheet showing the new Opening Balance Equity line and totals that tie out post-repair

## Open Questions

1. **Third-writer scope expansion** — fixing `/api/import/balances` (+undo) was not in the ticket text but is a hard prerequisite for the constraint. Approve including it here?
2. **Opening Balance Equity `3000`** as the import contra — approve convention (or run `/decide` first)?
3. **Surcharge → `5600` contra-expense** (vs a new surcharge-income account) — approve convention (or `/decide`)?
4. Post-repair, the pilot unit shows **negative equity ≈ −$15.3k** on the balance sheet (truthful: imported scout-fund liabilities without importing the matching bank balance). Acceptable dev artifact? (Prod repair, when separately approved, will surface the same and is the honest state until the treasurer books the real bank opening balance.)
