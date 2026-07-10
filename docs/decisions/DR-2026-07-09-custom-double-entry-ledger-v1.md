# DR: Custom Double-Entry Ledger (not Medici) v1

**Date:** 2026-07-09 (retroactive — records a choice made at Phase 0 build-out, early 2026)
**Status:** Active
**Supersedes:** None
**Affects Features:** platform-foundation; all finance features (scout accounts, billing, payments, expenses, reporting)

## Decision

Chuckbox implements double-entry accounting as a **custom PostgreSQL-native design** — `journal_entries`/`journal_lines` tables, SECURITY DEFINER RPCs for money movement, and triggers that maintain denormalized `scout_accounts` balances — rather than adopting the Medici library the strategic roadmap (v2.2 §5.2, Module 1) recommended. The ledger lives in the database, not in an application-layer library.

## Context

- The roadmap recommended Medici (a Node.js double-entry library) explicitly to avoid hand-rolling edge cases: "voided transactions, partial refunds, fiscal year rollovers... are easy to get wrong."
- The build chose custom anyway, for structural reasons that remain valid:
  - **Medici is MongoDB-native**; Chuckbox's stack is Supabase/PostgreSQL with Row-Level Security as the tenancy boundary. Adopting Medici would have meant a second datastore or a heavy port.
  - Postgres-native money movement lets mutations be **atomic in one RPC** (`process_payment_link_payment` with `FOR UPDATE` locks is the model), enforceable by RLS, and auditable by DB triggers — none of which an app-layer ledger gets for free.
  - The dual-balance scout-account model (`billing_balance` + `funds_balance`) is a domain-specific sub-ledger shape no off-the-shelf library provides.
- **The roadmap's warning materialized.** The 2026-07-09 audit (`reports/2026-07-09-chuckbox-current-state-audit.md`) catalogued the predicted cost: the balance invariant (Σdebits = Σcredits) exists as a function but is enforced nowhere; two live paths write unbalanced entries; several treasurer paths are non-transactional sequential writes; void/reversal semantics are incomplete; three "paid" mechanisms compete.
- Alternatives considered at decision time: Medici (rejected — datastore mismatch), other JS accounting libraries (immature), no double-entry at all (rejected — audit-ready fund accounting is the product wedge).

## Consequences

### What changes

Nothing changes by this DR itself — it records the standing architecture. It does, however, make the **hardening obligations** explicit and binding:

1. The DB must **enforce** the balance invariant (constraint trigger: Σdebit = Σcredit per journal entry) — not merely define a validation function.
2. Every money-moving mutation is a **single transactional RPC** that validates caller role/membership internally (the `process_payment_link_payment` pattern). Sequential multi-statement writes from app code are non-conforming legacy to be ported.
3. Denormalized balances (`scout_accounts`) are derived state maintained by triggers; any clamp or silent correction (e.g. `GREATEST(0, …)`) that can hide ledger drift is a defect.
4. Finance changes require DB-level integration tests proving the invariants (per the approved 2026-05-25 finance-integration-tests spec).

### What stays the same

- The schema shape (`journal_entries`, `journal_lines`, `accounts`, `scout_accounts` dual balances) and the RPC-centric direction.
- The `computeAllocations` engine as the single application-layer allocation authority.
- No migration to any external accounting library.

### Trade-offs

- **Pro:** atomicity, locking, RLS, and audit triggers live where the data lives; one datastore.
- **Pro:** domain-fit — dual-balance scout accounts and unit-scoped chart of accounts are first-class.
- **Con:** we own every accounting edge case (voids, refunds, fee conventions, rollovers) — *mitigation:* invariant enforcement + integration tests (obligations 1 & 4 above).
- **Con:** logic split across SQL migrations and TypeScript raises the review burden; RPC drift (e.g. missing role checks) has already occurred — *mitigation:* obligation 2 makes the RPC pattern the sanctioned path.

### Risks

- Invariant enforcement lands on a ledger with historical unbalanced entries → the constraint must ship with a data-repair pass, or it will block legitimate writes.
- Fiscal-year rollover remains undesigned; first year-end close will surface it.
- Watch for: new money paths added as app-layer sequential writes (non-conforming), and reports diverging from balances (symptom of trigger/`is_posted` inconsistency).

---

## Changelog
- **v1 (2026-07-09):** Initial decision — recorded retroactively during method adoption; consequences sourced from the 2026-07-09 current-state audit.
