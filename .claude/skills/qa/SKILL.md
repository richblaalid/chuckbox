---
name: qa
description: Take a batch of functional/UX QA feedback end-to-end — triage each item (defect vs. change-of-intent), reproduce confirmed defects in a running stack, fix them through the validated loop (one PR per feature, one Linear ticket + commit per defect), re-verify each acceptance criterion with a browser screenshot, and route intent changes to /ground. Use when the user hands you a batch of QA feedback to fix.
argument-hint: [inline feedback text | path/to/feedback.md | empty to scan docs/grounding/qa/inbox/]
allowed-tools: Read Write Edit Glob Grep Bash Agent TodoWrite AskUserQuestion mcp__claude_ai_Linear__get_issue mcp__claude_ai_Linear__list_issues mcp__claude_ai_Linear__list_issue_statuses mcp__claude_ai_Linear__save_issue mcp__claude_ai_Linear__save_comment mcp__claude_ai_Linear__prepare_attachment_upload mcp__claude_ai_Linear__create_attachment_from_upload
---

# QA Feedback Pipeline

Drive a **batch** of QA feedback from "reported" to "fixed-and-proven PR." This skill is the inverse of `/implement`: it composes the interactive triage of `/ground`, the validated per-task fix loop of `/execute`, and the Preflight isolation + acceptance-criterion verification + Linear journaling of `/implement`.

**Autonomy model:** TWO human gates. GATE 1 approves the triage (what's a defect vs. a change-of-intent vs. noise). GATE 2 approves the fix plan (tickets + proposed fixes). Between them, confirmed defects are reproduced. After GATE 2 the fix → verify → PR runs per feature group without further pauses, stopping only if a validation step genuinely fails (see Failure handling).

**Core principles:**
- **Defect = the PR-sized unit.** Each confirmed defect is one Linear ticket, one validated commit. One PR per *feature*, bundling that feature's defect commits. Never bundle unrelated defects into one commit.
- **CHANGE-vs-defect is the load-bearing judgment.** If the feedback can be satisfied *without* changing what the docs say the feature should do → it's a defect/polish, fix it. If satisfying it would change a documented requirement or AC → it's a `CHANGE`, route it to `/ground`; never silently fix it.
- **Never fix blind.** A defect you cannot reproduce flips to *needs-info* and is reported, not patched.
- **The ticket is the journal.** Each defect's Linear ticket carries repro, fix, AC result, and screenshot. The batch QA report is the cross-item artifact.
- **Verify behavior, not internals.** ACs are proven by exercising the running app in an authenticated session; the screenshot is evidence of final state.

---

## Preflight: worktree & isolation offset

Before triaging any feedback, confirm this run is isolated for safe parallelism and pin an `OFFSET` for the rest of the session. `/qa` builds and verifies against a running stack, so it needs the same isolation `/implement` has.

**1. Require a linked git worktree.** This skill is built to run in a dedicated worktree so parallel runs don't collide. Detect it:

```bash
git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null)
case "$git_dir" in
  */worktrees/*) echo "linked-worktree" ;;
  *)             echo "main-working-tree" ;;
esac
```

- If `linked-worktree` → continue.
- If `main-working-tree` → **stop and tell the user** they're on the main checkout, which is not parallel-safe (it shares the dev-server port with any other run). Ask: proceed here anyway with `OFFSET=0` (only safe if nothing else is running), or abort so they can create a worktree first. Do not silently continue on the main tree.

**2. Resolve a stable `OFFSET`.** The offset shifts the web port (`make dev OFFSET=N` → Next.js on `3000+N`). Persist it in the worktree's private git dir (per-worktree, never tracked):

```bash
offset_file="$git_dir/qa-offset"
if [ -n "$OFFSET" ]; then
  offset=$OFFSET                              # explicit env wins
elif [ -f "$offset_file" ]; then
  offset=$(cat "$offset_file")                # reuse this worktree's pinned offset
else
  for _ in $(seq 1 25); do                    # pick a random free offset, 1..89 → web 3000+N
    c=$(( (RANDOM % 89) + 1 ))
    if ! lsof -i :$((3000+c)) >/dev/null 2>&1; then offset=$c; break; fi
  done
  echo "$offset" > "$offset_file"
fi
echo "OFFSET=$offset  (web :$((3000+offset)))"
```

Use this `offset` for every later `make dev`, port computation, and browser URL. Report the chosen offset + port to the user, and note it in the QA report so a parallel run is traceable.

**⚠️ Shared database.** All worktrees share the ONE remote dev Supabase project — there is no per-worktree DB. Never run destructive db scripts (`db:reset`, `db:fresh`, `db:restore`) while another run may be active; sequence migration-bearing fixes rather than parallelizing them; clean up test data you create.

**3. Capture a test baseline (before touching any code).** Some suites may already be red on `main`; record the failing set *now*, while triage runs:

```bash
# Kick off in the background; stash the list of currently-failing tests.
make test > "$git_dir/qa-baseline.log" 2>&1 &
```

When you later run the full suite (pre-PR gate, Phase 5), diff against this baseline: a failure present in `qa-baseline.log` is pre-existing (note it, don't chase it); a failure *not* in the baseline is yours to fix.

---

## Step 0: Gather the feedback batch

`$ARGUMENTS` is the QA feedback. Resolve it:

1. If `$ARGUMENTS` looks like a file path (contains `/` or ends `.md`), read that file as the batch.
2. If `$ARGUMENTS` contains substantial text, treat it as the inline batch.
3. If `$ARGUMENTS` is empty, scan `docs/grounding/qa/inbox/` for files; if multiple, list them and ask which to process; if none, ask the user to provide feedback.
4. An optional trailing Linear ticket/PR reference (e.g. `… ref CHUCK-123`) is **context only** — `/qa` still creates fresh tickets per defect (it does not append to that PR by default).

Each raw item ideally carries **where / what-you-saw / what-you-expected / screenshot**. Loose prose is fine — you normalize it in Phase 1.

---

## Step 1: Load orientation

1. Read top-level `CLAUDE.md` and `docs/CLAUDE.md` (doc-system rules, commit style, classification).
2. **Read `docs/glossary.md`** — Scouting/BSA and fund-accounting terminology has critical distinctions (billing_balance vs funds_balance, rank vs merit-badge requirements, unit vs troop/pack); load it before interpreting feedback (project rule).
3. Read `docs/testing.md` (AC ID prefixes + Given/When/Then format) and, if UI feedback, any route ↔ screen mapping the docs provide.
4. Read the feature index so each item can be mapped to a `docs/features/[feature]/` folder. Read a feature's `requirements.md` + `tests.md` when an item lands on it (for the implicated `AC-…` id and the next-available task number).

---

## Phase 1: Triage (interactive)

Run a `/ground`-style per-item triage. Do **not** start fixing during triage.

1. **Split** the batch into discrete, numbered items. Normalize each to *where / saw / expected*.
2. **Propose** a classification + mapping for each item:
   - **Class:** `BUG` (defect vs. an existing AC) · `UX` (polish on an existing AC, or an intent shift) · `CHANGE` (new/changed requirement) · `DUP/UNCLEAR`.
   - **Mapping:** the implicated feature folder, the specific `AC-…` id(s), and a **severity** (blocker / major / polish).
   - Apply the CHANGE-vs-defect rule (see Core principles) to separate `UX` from `CHANGE` — this is the call that keeps un-recorded requirement changes out of the codebase.
3. **Triage each item** at a cadence the user picks (ask once): **item-at-a-time** (most precise) · **sub-area-at-a-time** (default) · **section-at-a-time** (fastest). Per-item verbs:
   - **Confirm** — accept the classification. A confirmed `BUG`/`UX` is eligible to fix; a confirmed `CHANGE` goes to the route-to-`/ground` list.
   - **Reclassify** — move between `BUG` / `UX` / `CHANGE`, then re-decide.
   - **Drop** — not real / duplicate.
   - **Reproduce-now** — try a quick repro before deciding (uses Phase 2 machinery early).
   - **Defer** — real but out of scope → append a one-line entry under the matching topic in `docs/future-phases/backlog.md` (the same backlog `/ground` defers to).
4. Maintain three running lists: **confirmed defects**, **route-to-`/ground` (CHANGE)**, **needs-info / deferred**.

### **GATE 1 — STOP. Approve the triage.**

Present the triaged table (per item: #, item, class, feature, AC, severity, verdict). Ask: **"Approve this triage to reproduce the confirmed defects, request changes, or abort."** Do not proceed until the user explicitly approves.

---

## Phase 2: Reproduce confirmed defects

Prove each confirmed defect fails *before* fixing it.

1. **Bring the stack up** on the pinned `OFFSET`: if `http://localhost:$((3000+OFFSET))` doesn't answer, start `make dev OFFSET=$OFFSET` in the background and poll until ready. The app talks to the shared dev Supabase project; the seeded test users (see the **Test User Credentials** table in `CLAUDE.md` — one login per role) are your deterministic identities.
2. **Reproduce against the AC** in an authenticated session — log in as the role the AC implicates (a parent-facing defect must be reproduced as the parent user). Use the browser (Playwright MCP or claude-in-chrome) for visual/interaction defects; use authenticated requests (mint a session the way `tests/e2e/global-setup.ts` does) for API-shaped defects.
3. **Record per defect:** reproduced / partial / **can't-reproduce**. A can't-reproduce defect flips to **needs-info** — report it, do not fix it.
4. **Group** the reproduced defects by feature folder. Each group becomes one branch + one PR in Phase 4.

---

## Phase 3: Produce the fix plan

1. **Create a Linear ticket per reproduced defect** (`save_issue` to the **Chuckbox** project; resolve status via `list_issue_statuses`): title, the failing `AC-…`, repro steps, expected vs. actual, severity, feature label. Capture the returned ticket id and its branch name.
2. **Add a fix task per defect** into that feature's `docs/features/[feature]/tasks.md`, status "Not Started", using the feature's ID prefix and next-available number, matching the existing table format — so the fix loop (and any later `/execute` resume) reads it natively.
3. **Write the batch QA report** to `docs/grounding/qa/YYYY-MM-DD-[slug]-report.md` (create `docs/grounding/qa/` if absent) from `${CLAUDE_SKILL_DIR}/qa-report-template.md`: fill the triaged-items table, confirmed-defects table (with ticket ids), needs-info, routed-to-`/ground`, and deferred sections.

### **GATE 2 — STOP. Approve the fix plan.**

Present, grouped by feature: the tickets, the `tasks.md` fix-tasks, and the proposed fix for each defect — plus the needs-info and CHANGE lists. Ask: **"Approve this fix plan to implement, request changes, or abort."** Do not proceed until the user explicitly approves.

---

## Phase 4: Fix loop (sequential, one feature group at a time)

Process feature groups **sequentially** in this one worktree — never open parallel branches in a single run. For each feature group:

1. **Branch** fresh off an up-to-date `main`: `qa/[feature]-YYYY-MM-DD`. (Never fix on `main`.)
2. For each defect's fix-task, run the `/execute` per-task loop:
   - Mark the task "In Progress" in `tasks.md`.
   - **TDD where the fix is business logic** — first write the failing test that *encodes the AC* (Vitest + React Testing Library), watch it fail, then write the minimal fix. **Build-and-smoke** for infrastructure-only fixes.
   - **Validate cheaply at task scope:** `make lint`; `npx tsc --noEmit` plus the task's own vitest files; invoke the `code-simplifier:code-simplifier` subagent on the changed files, then re-check. Do **not** run a full `make build`/full suite per defect — that runs once per group in Phase 5.
   - **Types ordering exception:** a fix that changes a database migration must push it to the dev Supabase project and regenerate `src/types/database.ts` before any fix that consumes the new shapes (see `CLAUDE.md` Supabase safety rules — dev project only).
   - Keep scope on the defect — adjacent breakage becomes a new task, not a "while I'm here" edit.
   - Mark "Done", move the row to the Completed table with the date. **Commit only this defect's files** (never `git add -A`), message `fix([scope]): [TICKET-ID] [imperative description]`. Do not push yet.
3. Post a Linear comment per defect with the commit hash; call out every deviation from the approved plan the moment it happens.

---

## Phase 5: Re-verify (per feature group)

1. **Re-prove each AC** in an authenticated session as the implicated role (primary) and capture a screenshot as evidence (secondary), saved to `docs/grounding/qa/[slug]-screenshots/[ticket]-[ac].png`. Heed the Chuckbox gotchas from `implement/SKILL.md` Phase 4: middleware redirects can abort direct navigation to protected routes, wait for hydration before asserting, feature flags are render-time, and role determines what's visible.
2. **Run the full gate once for this group:** `make build` then `make test`. Diff failures against `qa-baseline.log` from Preflight — pre-existing failures are noted, not chased; new failures are yours. A **red AC blocks only this group**, not the others.
3. Write the AC→pass results into the QA report's Verification Results table and post them as a Linear comment on each ticket. **If any AC fails, treat it as a Phase-4 failure** — fix and re-verify within this group before its PR; if the fix itself fails validation, follow Failure handling (stop and ask).

---

## Phase 6: PR + finalize (per feature group)

For each feature group, after its ACs pass:

1. **Push** the feature branch.
2. **Open one PR per feature** against `main` with `gh pr create`: title `[feature] QA fixes — [N] defects`; body = per-defect task list with commit hashes, the AC→pass table, the screenshot(s), `Fixes CHUCK-…` for each ticket, any deviations/deferrals, and the standard `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.
3. **Embed each defect's screenshot inline on its Linear ticket** (an attachment row alone won't render): `prepare_attachment_upload` → immediately `PUT` the raw bytes with the signed headers (60-second expiry) → `save_comment` with `![caption](<assetUrl>)` using the bare `uploads.linear.app/...` URL. Then move each ticket to **In Review** (`save_issue`).

---

## Phase 7: Route change-of-intent items + report

1. **CHANGE items:** offer to chain `/ground` on the set-aside list now (so intent changes enter the docs pipeline immediately), or list them with their feature/AC context for the user to run later. Never fix them in this run.
2. **Final report** in chat, grouped by feature: branch, PR URL, defects fixed, AC pass/fail, screenshot paths — plus the consolidated CHANGE / needs-info / deferred lists and the QA report path.

---

## Failure handling

If any validation step (lint, build, test, or an AC check) fails:

1. **Stop the chain.** Do not advance to the next defect or feature group.
2. Revert the failing task's status to "Not Started" (or "Blocked") in `tasks.md`. Roll back only clearly-broken uncommitted files with `git restore` on specific paths — **never** `git reset --hard`.
3. Diagnose: report the defect, the step, the exact command output, and your read of the root cause — in chat **and** as a Linear comment on that defect's ticket.
4. Ask the user: fix-and-retry, skip (mark Blocked), or stop. Do not retry the same failing command blindly; do not destructively reset state. **Per-feature isolation:** a red group does not block the others — finish or report the rest. The pipeline is resumable from `tasks.md` + the QA report.

---

## Principles

- **Two gates, then trust the plan.** Triage and fix-plan are the contracts. After GATE 2, don't quietly redesign — note deviations on the ticket as they happen.
- **The ticket is the journal.** Repro, fix, AC result, and screenshot all land on the defect's Linear ticket. Someone reading only the ticket understands what broke and how it was proven fixed.
- **Defect vs. change-of-intent.** Fixing a defect restores documented behavior; changing documented behavior is a `/ground` (or `/decide`) conversation, not a `/qa` commit.
- **Verify behavior, not internals.** A defect isn't fixed until its observable AC passes in the running app.
- **Scope stays tight.** Fix the defect, nothing else. Adjacent breakage becomes a new task.
