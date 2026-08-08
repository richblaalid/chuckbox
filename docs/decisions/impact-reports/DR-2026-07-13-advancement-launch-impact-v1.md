# Impact Report: Advancement Harden + Launch v1

**DR:** docs/decisions/DR-2026-07-13-advancement-launch-v1.md
**Generated:** 2026-07-13

## Summary
- Files affected: 4 (prd.md, tech.md, features/advancement/requirements.md, features/advancement/tasks.md)
- ACs requiring updates: 0 (no advancement tests.md exists yet)
- New ACs recommended: 4 (land in features/advancement/requirements.md now; migrate to tests.md when created)
- Superseded DRs: 0
- Linear impact: CHUCK-4 gate resolved; CHUCK-27 → Urgent; CHUCK-28/29/30 confirmed/raised as launch-prep

## Conflicts
- **Roadmap v2.2** planned advancement as synced-from-Scoutbook only; this DR consciously ratifies the expansion. The roadmap is read-only historical context (divergence already flagged in `docs/prd.md`); the pending roadmap v3 must incorporate the ratified scope — noted in prd.md's decision queue rather than edited into v2.2.
- No conflicts with active DRs (only DR-2026-07-09-custom-double-entry-ledger-v1 exists; no money movement here).

## Stale References
- `docs/prd.md` feature index: "Advancement tracking (native) — Built, dark … launch-or-freeze decision pending" → decision is no longer pending; row must move to launch-prep status.
- `docs/prd.md` known product debt item 2 ("Advancement: launch or freeze") → resolved by this DR; strike/annotate.
- `docs/features/advancement/requirements.md` status header ("Product scope is pending DR") → now ratified; rewrite status + add ratified ACs.
- `docs/tech.md` Active DR index → add this DR's row.

## ACs Requiring Updates (by file)
- None — no `docs/features/advancement/tests.md` exists yet.

## New ACs Recommended (record in requirements.md; migrate to tests.md when the hardening tickets land)
- **Server-side kill-switch (ADV-005):** with `ADVANCEMENT_TRACKING` disabled, every advancement mutation — including the CSV-import actions (`stageTroopAdvancement`, `importStagedAdvancement`, `processImportJobInternal`) — fails and performs no writes, even when invoked directly. (Correction 2026-07-13: native mutations were already gated 38/38; the import path was the gap.)
- **Unit scoping (CHUCK-27):** a leader of unit A cannot mutate advancement progress rows belonging to unit B, even with valid IDs of unit-B rows.
- **Import auth (CHUCK-28):** `processImportJob` rejects callers without leader/admin membership in the job's unit; a stalled import surfaces as failed, not stuck `processing` forever.
- **Data pipeline (CHUCK-30):** seeding from canonical data yields exactly 141 badges and validated requirement counts; seeder fails loudly on count drift.

## Downstream Doc Updates
- **docs/prd.md:** feature-index row for native advancement → "Launch-prep (gated)" with DR reference; decision-queue item 2 → resolved (point at DR); note extension-strategy decision (#3) as now highest-leverage.
- **docs/tech.md:** Active DR index — add DR-2026-07-13-advancement-launch-v1 row.
- **docs/features/advancement/requirements.md:** status → ratified launch-prep; add launch gates + recommended ACs above.
- **docs/features/advancement/tasks.md:** task statuses maintained by the /implement run (ADV-001..005).
- **docs/testing.md:** no change now — advancement AC strategy lands with tests.md when hardening tickets are built.

## Superseded DRs
- None.

## Linear Re-prioritization (executed as ADV-004)
| Issue | From | To | Why |
|---|---|---|---|
| CHUCK-27 | High | Urgent | Mandatory flag-flip gate on the ratified launch's critical path. (Corrected: native mutations are flag-gated, so the IDOR is dark-mode-safe except via the import path, which ADV-005 gates) |
| CHUCK-28 | High | High (confirmed launch-prep) | CSV import is the launch data feed |
| CHUCK-29 | Medium | High | N+1 bulk paths are launch-prep, not maintenance |
| CHUCK-30 | Medium | High | Yearly BSA data pipeline is a launch operating obligation |
| CHUCK-4 | — | comment | Gate D1 resolved: launch-prep mode |
