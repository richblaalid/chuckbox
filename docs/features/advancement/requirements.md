# Advancement — Requirements

**Status:** ratified launch-prep, 2026-07-13. [DR-2026-07-13-advancement-launch-v1](../../decisions/DR-2026-07-13-advancement-launch-v1.md) ratifies the native tracker as pilot scope (resolves CHUCK-26 / Epic D gate D1). `ADVANCEMENT_TRACKING` stays off in prod until the launch gates below clear.

## Launch gates (from the DR)

1. **CHUCK-27** — unit-scope every advancement mutation (cross-unit IDOR); mandatory before flag flip
2. **ADV-005** — kill-switch extended to the CSV-import mutations (native mutations already enforce it)
3. **CHUCK-28** — auth on `processImportJob` + stale-job watchdog (CSV import is the launch data feed)
4. **CHUCK-29 / CHUCK-30** — N+1 batching; BSA canonical-data yearly-update pipeline

## As-built capability (behind the flag)

- Native rank-requirement and merit-badge progress tracking for a unit's scouts: per-requirement sign-off, bulk entry, leadership positions, partials.
- Full BSA reference data pipeline: 141 merit badges / ~11k requirements seeded from `data/bsa-data-canonical-normalized.json`.
- Scoutbook troop-advancement **CSV import** (`src/app/actions/troop-advancement-import.ts`): parses Scoutbook's troop advancement export and stages/applies changes — the only data feed that exists today (extension sync is roster-only).
- Roles: leaders sign off / bulk-edit; parents and scouts view own progress (per `src/lib/roles.ts` nav gating).
- Scale: ~62 components, ~26k advancement-path lines, 59 server actions across 7 modules.

## Known constraints (carry into any requirement work)

- Scoutbook is the mandatory record; Chuckbox never displaces it (roadmap v2.2). No up-sync exists — native sign-off implies double entry until one does.
- `ADVANCEMENT_TRACKING` is enforced server-side in all native advancement mutations (verified 2026-07-13, 38/38 — `bulkSignOffForScouts` transitively via `bulkRecordProgress`); the CSV-import mutations lacked the check until ADV-005. Full unit-scoping is CHUCK-27; import auth is CHUCK-28.
- Cross-unit IDOR on advancement mutations (CHUCK-27) is a hard blocker on any flag flip.

## Acceptance criteria

Recorded here per the DR's impact report; migrate to `tests.md` as the hardening tickets land.

- **Server-side kill-switch (ADV-005):** with `ADVANCEMENT_TRACKING` disabled, every advancement mutation — including the CSV-import actions — fails and performs no writes, even when invoked directly, not just hidden in the UI.
- **Unit scoping (CHUCK-27):** a leader of unit A cannot mutate advancement progress rows belonging to unit B, even with valid IDs of unit-B rows.
- **Import auth (CHUCK-28):** `processImportJob` rejects callers without leader/admin membership in the job's unit; a stalled import surfaces as failed, never stuck `processing` forever.
- **Data pipeline (CHUCK-30):** seeding from canonical data yields exactly 141 badges with validated requirement counts; the seeder fails loudly on count drift.
