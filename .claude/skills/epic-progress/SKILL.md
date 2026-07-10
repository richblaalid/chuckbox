---
name: epic-progress
description: Compute and print ticket %-complete for each Linear "epic:*" label on the Chuckbox team. Reports per-epic completion with Done + In Review counting as complete, plus an overall roll-up — for dropping into product-update presentation graphics. Use when the user asks for epic progress, epic completion %, or a per-epic burndown from Linear.
argument-hint: (none) — optional: a single epic label like epic:A to report just that one
allowed-tools: Bash mcp__claude_ai_Linear__list_issue_labels mcp__claude_ai_Linear__list_issues
---

# Epic Progress Report

Print a per-epic ticket-completion breakdown from Linear for the **Chuckbox** team's build. Each epic is modeled as a Linear **label** named `epic:*` (e.g. `epic:A`, `epic:B`). Output is a chat table sized to copy into a presentation slide.

## Completion model (fixed — do not re-ask)

- **Unit = story count.** These issues carry no estimates/points, so every in-scope story counts as 1. `% = completed ÷ in-scope`.
- **Completed = status `Done` OR `In Review`.** (Merged PRs may sit in "In Review" rather than being moved to Done, so counting In Review reflects reality. `In Progress` does **not** count as complete.)
- **Exclude the epic's parent container issue.** Each epic has one header issue (e.g. `"Epic A — Financial Integrity Hardening"`) that also carries the `epic:*` label but is a container, not a deliverable. Detect it as any issue whose `id` is referenced as the `parentId` of a sibling in the same label — exclude those. (Belt-and-suspenders: also exclude issues whose title matches `^Epic [A-Z]\s+—`.)
- **Exclude `Canceled` and `Duplicate`** (`statusType` `canceled`/`duplicate`) from both numerator and denominator — they aren't real scope.

## Steps

1. **Discover the epic labels.** Call `list_issue_labels` with `team: "Chuckbox"`, `limit: 250`. Keep every label whose `name` starts with `epic:`. If the user passed a specific label in `$ARGUMENTS`, restrict to just that one.
2. **Pull issues per epic, in parallel.** For each epic label, call `list_issues` with `team: "Chuckbox"`, `label: "<epic:label>"`, `limit: 250`, `includeArchived: false`. Issue all the calls in a single batch.
3. **Classify each issue** within a label:
   - Collect the set of `parentId`s referenced by issues in this label → those parent issues are **containers**; drop them from scope.
   - Drop issues with `statusType` `canceled` or `duplicate`.
   - The remainder is **in-scope**. An in-scope issue is **complete** if its `status` is `Done` or `In Review`.
4. **Compute per epic:** in-scope count, complete count, and `pct = round(complete / inscope * 100)` (0% if inscope is 0). Sort epics alphabetically by label (`epic:A`, `epic:B`, …).
5. **Roll up** totals across all epics (sum in-scope, sum complete, overall %).
6. **Print a chat table** — columns: Epic | Label | In-scope | Done | In Review | % Complete. Keep epic display names from the label `description` where useful (e.g. `epic:A` → "Epic A — Financial Integrity Hardening"), else the bare label. End with a **Total** row.
7. **Flag two data-quality caveats** beneath the table, only when they actually apply this run:
   - **Status lag:** if any epic has 0 issues in `Done` status but completions come entirely from `In Review`, note that merged PRs may not have been moved to Done — so even this count can *under*-state reality. Optionally cross-check: `git log --oneline main | grep -oE 'CHUCK-[0-9]+'` lists ticket IDs that have merged commits; if a merged ID is still "In Review" in Linear, call it out as "shipped but not closed in Linear."
   - **Superseded stories:** if any issue description contains "supersede"/"supersedes"/"superseded", note it may be inflating its epic's denominator and should likely be canceled.

## Output shape (example)

```
## Epic completion — Chuckbox — <today>

| Epic | Label | In-scope | Done | In Review | % Complete |
|---|---|---:|---:|---:|---:|
| Epic A — Financial Integrity Hardening | epic:A | 9 | 2 | 3 | 56% |
| ... | | | | | |
| Total | | 34 | 5 | 4 | 26% |

Completion = Done + In Review. Caveats: <only if they apply>.
```

## Notes

- This is **read-only** — never mutate Linear. The skill reports; status hygiene is the user's call.
- If `list_issues` returns `hasNextPage: true` for any label (more than 250 issues — unlikely), page with `cursor` until exhausted before computing.
- Don't ask the user any questions; the completion model is fixed above. The only optional input is a single epic label in `$ARGUMENTS` to scope the report to one epic.
