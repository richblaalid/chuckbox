# Ticket Implementation Plan: CHUCK-26 — Product decision: launch or freeze native advancement tracking

**Generated:** 2026-07-12
**Linear:** CHUCK-26 — https://linear.app/blaahd-projects/issue/CHUCK-26/product-decision-launch-or-freeze-native-advancement-tracking
**Branch:** richardblaalid/chuck-26-product-decision-launch-or-freeze-native-advancement
**Status:** In Progress
**Gate outcome (2026-07-13):** Option **(a) harden + launch** ratified by product owner; ADV-005 kill-switch approved to land in this ticket. DR: `docs/decisions/DR-2026-07-13-advancement-launch-v1.md`.
**Affects Features:** advancement (new feature folder, scaffolded by this ticket), cross-cutting (prd.md, tech.md, decisions/)
**Epic:** CHUCK-4 — Epic D: Advancement Decision & Hardening

## Ticket Summary

This is a **decision ticket**, not a build ticket: ratify (or reject) the native advancement tracker as product scope via the `/decide` pipeline, producing a Decision Record. The deliverables are the DR, its impact report, downstream doc updates, and re-prioritization of the Epic D hardening siblings.

## Epic Context

- **Epic:** CHUCK-4 — Epic D: Advancement Decision & Hardening. This ticket is D1, the gate for the whole epic.
- **Sibling tickets:**
  - CHUCK-27 — Todo, High — unit-scope all advancement mutations (cross-unit IDOR); hard blocker on any flag flip
  - CHUCK-28 — Todo, High — auth on `processImportJob` + stale import-job watchdog
  - CHUCK-29 — Todo, Medium — batch remaining N+1 bulk advancement paths; delete dead code
  - CHUCK-30 — Todo, Medium — BSA canonical-data yearly-update pipeline + close 8 open badge fixes
- **This ticket's boundary:** the decision + docs + Linear re-prioritization only. No hardening code lands here — that is sibling scope. One possible exception (server-side flag kill-switch) is an open question for the gate.

## Grounding Extract

- **Decisions implied** — choose one of: (a) harden + launch native tracker as pilot feature; (b) freeze — keep dark, stop investing, focus on sync strategy; (c) partial — launch read-only advancement views fed by synced/imported data, keep native sign-off dark.
- **New requirements** — whichever option is chosen must be recorded as a DR (this is a product-scope decision that cascades: prd.md feature index, decision queue, Epic D priorities, future roadmap v3).
- **Technical signals** — IDOR fix (CHUCK-27) is mandatory before any flag flip regardless of option.
- **Acceptance criteria** (observable doc/ticket state — see Verification Plan):
  1. An Active DR exists recording the chosen option, context, and consequences.
  2. An impact report enumerates all downstream doc effects.
  3. `docs/prd.md` (feature index + decision queue) and `docs/tech.md` (DR index) reflect the decision.
  4. Epic D siblings are re-prioritized in Linear per the decision, with an explanatory comment on CHUCK-4.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** No `docs/features/advancement/` folder exists — the largest module in the codebase is undocumented in the doc system. This plan scaffolds it (flagged per the /implement skill's new-feature rule). Roadmap v2.2 (`docs/Chuckbox_Strategic_Roadmap_v2_2.md`) frames advancement exclusively as **synced-from-Scoutbook** data: the "Sync-Link" engine (§Module 2), down-sync scraping, CSV fallback, and the Phase 1 milestone "Leaders can see advancement data pulled from Scoutbook." A first-party tracker with native sign-off is nowhere in the ratified roadmap.
- **Active DRs that apply:** DR-2026-07-09-custom-double-entry-ledger-v1 — not implicated (no money movement). No DR conflicts.
- **Conflicts detected:** none with active DRs; the *native tracker itself* is the unratified expansion the ticket exists to resolve.
- **Decision-record needed?** Yes — that is the ticket. The choice is made at the plan gate by the product owner; the pipeline then drafts and executes the DR.

### Evidence gathered (grounding facts for the DR)

1. **Module scale (measured):** 62 advancement `.tsx` components; ~25.9k lines across advancement-path TS/TSX files; 59 exported server actions across 7 action modules; full BSA data pipeline (141 badges / ~11k requirements seeded, canonical JSON + seeders).
2. **Prod exposure — CORRECTED during ADV-005.** The original finding ("`checkFeatureEnabled()` called by 0/59 actions") was a grep artifact: call sites use `checkFeatureEnabled<T>()`, which the literal-parens pattern missed. Verified reality: all 38 native advancement mutations enforce the flag server-side (`bulkSignOffForScouts` transitively via `bulkRecordProgress`); queries are ungated by design. The genuine dark-mode gap is the **CSV-import path** (`troop-advancement-import.ts`): `stageTroopAdvancement`/`importStagedAdvancement` have leader auth but no flag check, and `processImportJobInternal` is an exported server action on the admin client with **no auth and no flag check**. ADV-005 re-scoped to gate these three.
3. **Sync reality:** the extension is roster-only (v1.0.1). Advancement down-sync via extension is unbuilt and is itself decision-queue item #3. However, a **Scoutbook troop-advancement CSV import** already exists (`src/app/actions/troop-advancement-import.ts` + `src/lib/import/scoutbook-troop-advancement-parser.ts`) — a working data feed for option (c) without new sync work.
4. **Double-records risk:** Scoutbook remains the mandatory record; up-sync is unbuilt (Phase 2–3/cut). Native sign-off (option a) means leaders record everything twice — the exact failure mode roadmap v2.2 criticizes in TroopWebHost/TroopTrack.
5. **Option (c) hidden cost:** the flag is one boolean; read-only launch requires gating mutation affordances separately (sign-off buttons, bulk entry) across a ~62-component UI — real product/UI surgery beyond the hardening tickets.

## Task List

Tasks added to `docs/features/advancement/tasks.md` (new folder, scaffolded with this plan), status "Not Started".

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| ADV-001 | Draft DR (launch / freeze / partial, per gate decision) in `docs/decisions/` | no | gate decision | DR file exists, Status: Active, follows template |
| ADV-002 | Impact-analysis report in `docs/decisions/impact-reports/` | no | ADV-001 | report enumerates conflicts, stale refs, doc updates |
| ADV-003 | Execute downstream doc updates: prd.md feature index + decision queue, tech.md DR index, advancement/requirements.md | no | ADV-002 | docs reflect the decision; build/lint green |
| ADV-004 | Re-prioritize Epic D in Linear per decision; comment rationale on CHUCK-4 and each sibling | no | ADV-003 | Linear priorities/comments updated |
| ADV-005 | *(conditional — gate decision)* Server-side flag enforcement: `checkFeatureEnabled()` in all advancement mutation actions | yes | ADV-001 | failing test first; 0→N call sites; suite green |

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified |
|---|---|---|
| 1 | Active DR records the chosen option with context/consequences | File present in `docs/decisions/`, template-conformant, in PR diff |
| 2 | Impact report enumerates downstream effects | File present in `docs/decisions/impact-reports/`, in PR diff |
| 3 | prd.md + tech.md reflect the decision; decision-queue item 2 resolved | File diffs in PR; `make build`/`make lint` green |
| 4 | Epic D siblings re-prioritized with rationale | Linear priorities + comments visible on CHUCK-4/27/28/29/30 |
| 5 | (if ADV-005 approved) mutation actions reject when flag off | Vitest unit tests; full suite green vs. green baseline |

## Screenshot Plan

- **N/A (deviation, flagged):** this is a documentation/decision ticket with no runtime UI surface to screenshot — unless ADV-005 is approved, which is server-only. Evidence on the ticket will be the DR text, the PR diff, and the Linear re-prioritization instead of a browser screenshot.

## Open Questions

1. **Which option — (a) launch, (b) freeze, (c) partial read-only?** Product owner's call at the gate. Recommendation below.
2. **The unguarded-server-actions finding:** fold into CHUCK-27 (raise its framing to "exploitable today"), spin a new ticket, or take a minimal kill-switch here as ADV-005? Kill-switch is small (~1 task, mechanical) and de-risks prod under every option.
3. **Does the pilot troop actually want advancement visibility this season?** Material to (b) vs (c); not derivable from the repo.

## Recommendation

**(b) Freeze, plus the ADV-005 server-side kill-switch.** Rationale: the ratified strategy (roadmap v2.2) is sync-first with the financial module as the wedge; native sign-off without up-sync creates the double-records trap; the pilot is a single troop whose real usage is financial. Freezing keeps CHUCK-27/28 as security work on *reachable* surface (import + kill-switch), demotes CHUCK-29 to opportunistic, and scopes CHUCK-30 to yearly-maintenance only. Option (c) stays open as a cheap future upgrade — the CSV import feed already exists — and is the better choice *if* the pilot troop is asking to see advancement data now; it should ride on decision-queue item #3 (extension down-sync strategy) rather than pre-empt it.
