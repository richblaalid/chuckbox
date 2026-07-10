# Chuckbox — Product Snapshot (PRD Index)

**Status:** honest snapshot as of 2026-07-09 (method adoption). The strategic vision lives in `docs/Chuckbox_Strategic_Roadmap_v2_2.md` (v2.2, Jan 2026) — note that document has drifted from reality; see the current-state audit (`reports/2026-07-09-chuckbox-current-state-audit.md`) for the divergence analysis. A roadmap v3 is pending.

## What Chuckbox is

The "Unit Operating System" for Scouting America units (troops, packs, crews): financial operations, roster, and advancement tooling that Scoutbook (the mandatory official record) ignores or under-serves. Strategy: never displace Scoutbook as the record; capture the unit's operational workflows and automate the compliance link via a browser sync agent. Currently in private pilot with a single troop; real money flows in production.

## Users & roles

Five per-unit roles: **admin** (Key 3), **treasurer** (full financial), **leader** (roster + advancement sign-off), **parent** (own scouts' balances, pay), **scout** (own advancement). Auth is magic-link (Supabase OTP). A user can belong to multiple units (data layer complete; UI behind `MULTI_UNIT_CREATION` flag).

## Feature index

| Feature | Status | Notes |
|---|---|---|
| Scout accounts (dual-balance ledger) | **Live** | billing_balance + funds_balance; double-entry journal underneath |
| Fair-share billing | **Live** | billing records/charges, split or fixed; heavy 2026-05 iteration (PR #33/#36) |
| Payments (cash/card/funds) | **Live** | `computeAllocations` engine; Square card processing; payment links (`/pay/[token]`) |
| Parent portal | **Live** | View balances, receive charge/reminder emails, pay by link |
| Financial reporting | **Live** | Balance by patrol, scouts owing, transaction history, income & expense |
| Expenses & reimbursements | **Live** | Receipt OCR (Claude), Venmo tracking, approval emails — unplanned scope addition |
| Transactional email | **Live** | Resend; 5 templates; collection reminders |
| CSV imports | **Live** | Roster, charges, balances |
| Scoutbook sync (roster) | **Live (v1.0.1)** | Chrome extension, roster down-sync only; AI-parsed server-side |
| Advancement tracking (native) | **Built, dark** | Largest module; `ADVANCEMENT_TRACKING=false` in prod; launch-or-freeze decision pending; cross-unit authz hardening required before flag flip |
| Multi-unit | **Built, gated** | Data layer done; `MULTI_UNIT_CREATION=false` |
| Plaid bank view | **Built, gated** | `BANK_INTEGRATION=false` |
| Calendar/RSVP | **Ghost schema** | `events`/`event_rsvps` tables exist, zero app code — build-or-drop decision pending |
| Chat/SMS/newsletter, mobile app, up-sync, inventory tracker | **Not built** | Roadmap Phases 2–3 / cut scope |

## Known product debt (decision queue)

1. Roadmap v3 — ratify actual scope, re-sequence Phase 1 (owner: product)
2. Advancement: launch or freeze (blocks: authz hardening)
3. Extension strategy: advancement down-sync in extension? canary infra + CSV fallback
4. Calendar/RSVP: build or drop ghost schema
5. Fundraising inventory tracker: ratify the cut or schedule it
6. Parked specs: void/delete billing UX, email branding alignment, billing line-items↔total

## Where detail lives

Per-feature requirements accrete in `docs/features/[feature]/requirements.md` as features are grounded — this index stays lean. New product knowledge enters only via `/ground`; decisions via `/decide` (see `docs/CLAUDE.md`).
