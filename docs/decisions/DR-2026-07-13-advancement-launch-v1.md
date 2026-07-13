# DR: Advancement Tracking — Harden + Launch as Pilot Feature v1

**Date:** 2026-07-13
**Status:** Active
**Supersedes:** —
**Affects Features:** advancement (primary); cross-cutting: prd.md, tech.md, Epic D (CHUCK-4) sequencing

## Decision

Ratify the native advancement tracker as product scope: **harden it and launch it to the pilot troop** (option a). The module — rank-requirement and merit-badge progress tracking with leader sign-off, bulk entry, and the BSA reference-data pipeline — graduates from unratified dark code to a first-class pilot feature.

`ADVANCEMENT_TRACKING` stays **off in prod until the launch gates clear**:

1. **CHUCK-27** — unit-scope every advancement mutation (cross-unit IDOR). Mandatory before any flag flip; upgraded to *exploitable-today* urgency because the flag never gated server actions (see Context).
2. **ADV-005 (this ticket)** — server-side kill-switch: every advancement mutation action enforces `checkFeatureEnabled()`, so "dark" actually means unreachable until launch.
3. **CHUCK-28** — auth on `processImportJob` + stale-job watchdog (the CSV import is the launch-day data feed).
4. **CHUCK-29 / CHUCK-30** — N+1 batching and the BSA canonical-data yearly-update pipeline become launch-prep, not maintenance.

Scoutbook remains the mandatory record of record — Chuckbox never displaces it. Native sign-off therefore implies **double entry** (record in Chuckbox, re-key into Scoutbook) until an up-sync path exists; we accept this consciously as a pilot-scale cost and treat the extension advancement-sync decision (product-debt queue #3) as the follow-on that closes the loop.

## Context

The tracker is the single largest module in the codebase (measured 2026-07-12: 62 components, ~26k advancement-path lines, 59 server actions, 141 badges / ~11k requirements seeded) yet was never ratified: roadmap v2.2 planned advancement exclusively as *synced-from-Scoutbook* data (the "Sync-Link" engine; Phase 1 milestone "Leaders can see advancement data pulled from Scoutbook").

Alternatives considered:

- **(b) Freeze** — keep dark, stop investing, focus on sync. Rejected: abandons ~26k lines of working capability the pilot can use, and the sync-only path still lacks its down-sync build (extension is roster-only v1.0.1).
- **(c) Partial read-only launch** — views fed by the existing Scoutbook troop-advancement CSV import, native sign-off kept dark. Rejected as the *end state* (it under-uses the module and needs UI surgery to hide mutation affordances across ~62 components), but its insight is kept: the CSV import is the launch data feed.

Security context that shaped the gates: `ADVANCEMENT_TRACKING=false` gates only two page renders. `checkFeatureEnabled()` (`src/app/actions/advancement/utils.ts`) is called by **zero** of the 59 advancement server actions, and Next.js server actions are live POST endpoints regardless of UI gating — so the CHUCK-27 IDOR surface is plausibly reachable in prod today. Hence ADV-005 lands immediately with this DR, ahead of the full unit-scoping fix.

## Consequences

- **Epic D re-sequenced as launch-prep:** CHUCK-27 → Urgent; CHUCK-28/29/30 → High. CHUCK-4's gate question is resolved.
- **Interim safety:** ADV-005 makes the flag a real server-side kill-switch; CHUCK-27 remains the substantive fix.
- **Double-entry burden** on leaders until up-sync/extension advancement sync exists; the extension-strategy decision (queue #3) is now the highest-leverage open product decision and should be scheduled.
- **Yearly BSA data maintenance** becomes a real operating obligation (CHUCK-30's regeneration pipeline is launch-prep, not nice-to-have).
- **Docs:** `docs/features/advancement/` becomes a real feature folder; prd.md feature index moves the module from "Built, dark — decision pending" to "Launch-prep (gated)"; roadmap v3 must incorporate the ratified expansion.
- **Risk accepted:** first-party tracking partially overlaps the sync strategy; if the pilot shows double entry is untenable, a future DR may narrow scope toward (c)-style read-only + sync.

---
## Changelog
- **v1 (2026-07-13):** Initial decision — resolves CHUCK-26 (Epic D gate D1). Option (a) chosen at the /implement plan gate by the product owner.
