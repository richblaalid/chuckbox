# Advancement — Requirements

**Status:** as-built snapshot, 2026-07-12. The module is **built but dark** (`ADVANCEMENT_TRACKING=false` in prod). Product scope is **pending DR** (CHUCK-26, Epic D): launch, freeze, or partial read-only launch. This file records what exists; requirements will be ratified or pruned by that DR.

## As-built capability (behind the flag)

- Native rank-requirement and merit-badge progress tracking for a unit's scouts: per-requirement sign-off, bulk entry, leadership positions, partials.
- Full BSA reference data pipeline: 141 merit badges / ~11k requirements seeded from `data/bsa-data-canonical-normalized.json`.
- Scoutbook troop-advancement **CSV import** (`src/app/actions/troop-advancement-import.ts`): parses Scoutbook's troop advancement export and stages/applies changes — the only data feed that exists today (extension sync is roster-only).
- Roles: leaders sign off / bulk-edit; parents and scouts view own progress (per `src/lib/roles.ts` nav gating).
- Scale: ~62 components, ~26k advancement-path lines, 59 server actions across 7 modules.

## Known constraints (carry into any requirement work)

- Scoutbook is the mandatory record; Chuckbox never displaces it (roadmap v2.2). No up-sync exists — native sign-off implies double entry until one does.
- `ADVANCEMENT_TRACKING` gates page renders only; server actions do **not** call `checkFeatureEnabled()` (0/59) — hardening tracked in Epic D (CHUCK-26 gate question / CHUCK-27).
- Cross-unit IDOR on advancement mutations (CHUCK-27) is a hard blocker on any flag flip.

## Acceptance criteria

None ratified yet — pending the CHUCK-26 DR.
