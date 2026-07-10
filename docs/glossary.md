# Glossary — Chuckbox Domain Terminology

**Load this file before processing any product, technical, or requirements document.** Scouting/BSA and fund-accounting terminology has critical distinctions — misusing these terms produces wrong requirements and wrong code.

> Seeded 2026-07-09 during method adoption. Review and extend — especially any term the pilot troop uses differently.

## Financial terms (highest confusion risk)

| Term | Meaning | NOT to be confused with |
|---|---|---|
| **billing_balance** | What a scout **owes the unit** for charges (negative = owes money). Lives on `scout_accounts`. | `funds_balance` — the two are independent columns of a dual-balance model, not one number |
| **funds_balance** | Scout **savings** from fundraising/overpayments, spendable toward charges. Always ≥ 0. | The unit's bank balance; a scout's funds are a liability the unit holds *for* the scout |
| **Scout account (ISA)** | Per-scout sub-ledger (Individual Scout Account) with the dual balances above | The unit's general ledger accounts (`accounts` table: bank, AR, income, fees) |
| **Billing record vs billing charge** | A `billing_record` is the event-level bill ("Summer Camp 2026"); `billing_charges` are its per-scout rows | A `payment` — payments settle charges via `payment_allocations` |
| **Fair-share billing** | Splitting a total cost across selected scouts (split or fixed amounts) | Expense cost-sharing (`src/lib/expenses/cost-sharing.ts`) — an informal Venmo-tracker, not journaled |
| **Payment allocation** | Assignment of a payment's dollars to specific charges (`computeAllocations` engine; FIFO default, sticky manual) | Marking a charge `is_paid` — a derived outcome, not the mechanism |
| **Journal entry / journal lines** | Double-entry accounting record; lines must balance (debits = credits) | Denormalized `scout_accounts` balances, which are derived *from* journal activity by triggers |
| **Void vs delete** | Void = reversal entry preserving history (the only sanctioned undo); delete has no product path | Editing amounts in place — never done on posted financial records |
| **Pass fees to payer** | Unit setting: card surcharge added on top so the unit nets the base amount | Fees absorbed — unit receives net (base − Square fee) |

## Scouting terms

| Term | Meaning | NOT to be confused with |
|---|---|---|
| **Unit** | The Chuckbox tenant: a troop, pack, or crew. Everything is scoped by `unit_id` | BSA "council" or "district" (org layers above units); also not the Linear "team" |
| **Troop / Pack / Crew** | Unit types: Scouts BSA (11–17) / Cub Scouts (K–5) / Venturing (14–20). Program terms differ across them | Each other — advancement structures differ by program |
| **Rank requirement vs merit-badge requirement** | Separate hierarchies with separate progress tables (`scout_rank_requirement_progress` vs merit-badge progress). Requirements nest via `parent_requirement_id`; `is_header` rows are organizational, not completable | Each other; headers are never signed off |
| **Partial (merit badge)** | An incomplete badge started elsewhere (e.g. summer camp) with some requirements signed | A badge "in progress" started in-unit |
| **Scoutbook** | BSA's official database of record. Chuckbox syncs *from* it (roster down-sync today); it is never displaced | Chuckbox's own advancement tracking (native module, feature-flagged) |
| **Guardian** | Adult linked to a scout (`scout_guardians`); parents see only their own scouts' financial data | Unit adult/leader roster (`adults`, `unit_memberships`) |
| **Roles** | `admin`, `treasurer`, `leader`, `parent`, `scout` — per-unit membership roles (`unit_memberships`), central map in `src/lib/roles.ts` | Supabase auth users/profiles, which are unit-agnostic |
| **YPT / Youth Protection** | BSA policy: all adult↔youth digital communication must include a parent/guardian | General privacy/PII policy |

## Product-shape terms

- **Dual-balance model** — the core accounting design: charges owed (`billing_balance`) and scout savings (`funds_balance`) tracked separately, connected only by explicit funds-transfer operations.
- **Sync Agent** — the browser-extension pathway that moves Scoutbook data into Chuckbox (`chuckbox-extension/`, roster-only as of 2026-07).
- **Payment link** — tokenized public pay page (`/pay/[token]`) letting a parent pay by card without logging in.
