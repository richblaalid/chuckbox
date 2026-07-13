# Advancement — Tasks

**ID prefix:** `ADV`. Scaffolded 2026-07-12 by the CHUCK-26 ticket plan (`docs/grounding/tickets/CHUCK-26-plan.md`). Epic D hardening siblings (CHUCK-27/28/29/30) will land their own task rows here when picked up.

## Parallelization Guide

Single sequential lane — ADV-001→004 are the /decide pipeline for CHUCK-26 and must run in order. ADV-005 (gate-approved) is independent after ADV-001.

## Active Tasks

| Task ID | Description | Status | TDD? | Dependencies |
|---|---|---|---|---|
| ADV-005 | Server-side flag enforcement: `checkFeatureEnabled()` in all advancement mutation actions (gate-approved) | Not Started | yes | ADV-001 |

## Completed Tasks

| Task ID | Description | Completed |
|---|---|---|
| ADV-001 | Draft DR: advancement harden + launch (`DR-2026-07-13-advancement-launch-v1.md`) — option (a) per CHUCK-26 gate | 2026-07-13 |
| ADV-002 | Impact-analysis report (`DR-2026-07-13-advancement-launch-impact-v1.md`) | 2026-07-13 |
| ADV-003 | Downstream doc updates: prd.md index + decision queue, tech.md DR index, advancement/requirements.md | 2026-07-13 |
| ADV-004 | Re-prioritized Epic D in Linear (CHUCK-27→Urgent; 29/30→High; comments on CHUCK-4 + siblings) | 2026-07-13 |
