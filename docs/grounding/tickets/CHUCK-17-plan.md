# Ticket Implementation Plan: CHUCK-17 — Fix pre-existing lint errors + add CI repo secrets (unblock green CI)

**Generated:** 2026-07-11
**Linear:** CHUCK-17 — https://linear.app/blaahd-projects/issue/CHUCK-17/fix-pre-existing-lint-errors-add-ci-repo-secrets-unblock-green-ci
**Branch:** richardblaalid/chuck-17-fix-pre-existing-lint-errors-add-ci-repo-secrets-unblock (worktree branch: CHUCK-17)
**Status:** In Progress (plan approved 2026-07-11; gate answer: ticket scope only — no `--max-warnings 0`)
**Affects Features:** platform-foundation (pseudo-feature)
**Epic:** CHUCK-2 — Epic B: Delivery Infrastructure

## Ticket Summary

Make CI green from day one: fix the pre-existing lint errors that made `make lint` exit non-zero, clean the unused `eslint-disable` directive warnings, and add the two `NEXT_PUBLIC_SUPABASE_*` repo secrets the workflow needs.

## Epic Context

- **Epic:** CHUCK-2 — Epic B: Delivery Infrastructure (CI, monitoring, schema hygiene; audit §3 P0-4). Child tickets mirror `docs/features/platform-foundation/tasks.md`.
- **Sibling tickets:** CHUCK-18 (Todo — prod-schema reconciliation, PLATFORM-007), CHUCK-19 (Todo — Sentry, PLATFORM-008), CHUCK-20 (Todo — integration-test split, PLATFORM-009), CHUCK-21 (Todo — typecheck tests + coverage, PLATFORM-010).
- **This ticket's boundary:** the lint/CI-secrets unblock only. Test hermeticity and typecheck-gate expansion belong to CHUCK-20/21.

## ⚠️ Reconciliation with reality (as of 2026-07-11)

**Most of this ticket was already delivered by CHUCK-7 / PR #37** (merged 2026-07-11, commit `c15247f`), which hit the same wall when its CI run went red:

| Ticket item | Status today | Evidence |
|---|---|---|
| (1) Rename `useScoutbookValue` in `import.ts` | ✅ Done in c15247f | renamed `shouldUseScoutbookValue`; 0 occurrences of old name |
| (2) react-compiler error in `signup-wizard.tsx:173` | ✅ Done in c15247f | missing `signupPath` dep added to `useCallback` |
| (3) ~15 unused `eslint-disable` directive warnings | ❌ **8 remain** (6 files) | current `make lint` output |
| (4) Repo secrets `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY` | ✅ Added 2026-07-10 | `gh secret list` |
| Done-when: `make lint` exit 0 locally | ✅ Already true | exit code 0 (0 errors, 8 warnings) |
| Done-when: CI fully green on a PR | ✅ Already true | PR #37 CI run success; main push green |

**Remaining scope = item (3) only:** remove the 8 unused `eslint-disable` directives:

- `scripts/scrape-requirement-resources.ts:550`
- `src/app/actions/funds.ts:109`
- `src/app/actions/onboarding.ts:335, 417, 509, 561`
- `src/components/settings/collection-settings-card.tsx:63`
- `tests/unit/lib/auth.test.ts:40`

## Grounding Extract

- **Decisions implied** — lint output should be clean (not just non-failing): unused suppressions get removed, not tolerated.
- **Technical signals** — all 8 are `@typescript-eslint/no-explicit-any` disables that no longer suppress anything (the underlying `any`s were fixed in earlier cleanups). Removal is mechanical and auto-fixable.
- **Acceptance criteria** — `make lint` exit 0 (now also 0 warnings); CI fully green on this ticket's PR.

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** `docs/features/platform-foundation/` — PLATFORM-005 (CI workflow) is the artifact this ticket unblocks; PLATFORM-011/CHUCK-7 already fixed the error-level items.
- **Active DRs that apply:** none (DR-2026-07-09-custom-double-entry-ledger-v1 is unrelated).
- **Conflicts detected:** none — but the ticket is stale relative to the tree; the done-when criteria are already satisfied by sibling work. This plan narrows execution to the one remaining item and records the rest as verification.
- **Decision-record needed?** No. One optional judgment call surfaced at the gate (below): whether to add `--max-warnings 0` to the lint script so future unused directives fail CI instead of accumulating silently. Small enough to not need a DR either way.

## Task List

Added to `docs/features/platform-foundation/tasks.md` (next free ID was PLATFORM-012):

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| PLATFORM-012 | Remove the 8 unused `eslint-disable` directives (6 files) so `make lint` reports 0 errors / 0 warnings | no | none | `make lint` exit 0 with clean output; `npx tsc --noEmit` green |

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified | Result (2026-07-11) |
|---|---|---|---|
| 1 | `make lint` exits 0 locally | run `make lint`, capture exit code + clean output (0 errors, 0 warnings) | ✅ PASS — exit 0, zero errors/warnings after `3df2615` |
| 2 | First CI run on a PR fully green (build → lint → test) | this ticket's own PR: `gh pr checks` / Actions run showing build → lint → test success | ✅ PASS — PR #38 run 29170338143: Success, verify 2m33s (`ci-green.png`) |
| 3 | Repo secrets present (user action, already done) | `gh secret list` shows both `NEXT_PUBLIC_SUPABASE_*` keys | ✅ PASS — both present, set 2026-07-10 |
| 4 | Ticket items 1–2 remain fixed | grep shows no `useScoutbookValue`; lint reports no rules-of-hooks / react-compiler errors | ✅ PASS — 0 grep hits; lint clean |

Full local gate: `make build` exit 0; `make test` 1210 passed / 36 skipped — identical to the pre-work baseline (no new failures).

## Screenshot Plan

No UI surface — this is delivery infrastructure. Evidence-of-record instead:

- **What to capture:** the GitHub PR checks page (browser screenshot) showing the CI run green on this ticket's PR, saved to `docs/grounding/tickets/CHUCK-17-screenshots/ci-green.png`.
- **Login:** n/a (GitHub, not the app).

## Open Questions

1. **Tighten the gate?** Should the lint script gain `--max-warnings 0` so unused-directive warnings fail CI in future instead of silently accumulating? Not in the ticket's scope; cheap to add here if wanted. Default: **not** doing it unless approved.
2. Secrets were added with dev-project values on 2026-07-10 (by CHUCK-7 work) — confirming that satisfies item (4) as the ticket intended (it does, per the ticket's own parenthetical "user action — dev project values").
