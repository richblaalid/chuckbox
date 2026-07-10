---
name: implement
description: Take a Linear ticket end-to-end — fetch it, ground it against the docs/DRs, write a ticket plan, execute the tasks, verify against acceptance criteria with a browser screenshot, open a PR against main, and keep the ticket updated throughout. Use when the user points you at a Linear issue (ID or linear.app URL) and wants it built.
argument-hint: [Linear issue ID or URL, e.g. CHUCK-123 or https://linear.app/...]
allowed-tools: Read Write Edit Glob Grep Bash Agent TodoWrite AskUserQuestion mcp__linear-chuckbox__get_issue mcp__linear-chuckbox__list_issues mcp__linear-chuckbox__get_project mcp__linear-chuckbox__list_comments mcp__linear-chuckbox__save_comment mcp__linear-chuckbox__save_issue mcp__linear-chuckbox__list_issue_statuses mcp__linear-chuckbox__prepare_attachment_upload mcp__linear-chuckbox__create_attachment_from_upload
---

# Ticket Implementation Pipeline

Drive a single Linear ticket from "picked up" to "PR open." This skill composes the discipline of `/ground` (distill + analyze against the docs) and `/execute` (validated, one-commit-per-task implementation), then adds inline verification, a real browser screenshot, a PR, and continuous ticket updates.

**Autonomy model:** ONE human gate — at the plan. You stop once to get the ticket plan + task list approved. After approval you run grounding → execute → verify → screenshot → PR end-to-end without further pauses, stopping only if a validation step genuinely fails (see Failure handling).

**Core principles (inherited):**
- One task = one commit = one PR-sized unit. Never bundle tasks, never skip validation, never expand scope. (from `/execute`)
- All product knowledge enters through grounding — the ticket is raw signal, not gospel; reconcile it with the docs and DRs before building.
- Keep the ticket honest: post what you actually did, including deviations and failures.

---

## Preflight: worktree & isolation offset

Before touching the ticket, confirm this run is isolated for safe parallelism and pin an `OFFSET` for the rest of the session.

**1. Require a linked git worktree.** This skill is built to run in a dedicated worktree per ticket so multiple `/implement` runs don't collide. Detect it:

```bash
git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null)
case "$git_dir" in
  */worktrees/*) echo "linked-worktree" ;;
  *)             echo "main-working-tree" ;;
esac
```

- If `linked-worktree` → continue.
- If `main-working-tree` → **stop and tell the user** they're on the main checkout, which is not parallel-safe (it shares the dev-server port with any other run). Ask: proceed here anyway with `OFFSET=0` (only safe if nothing else is running), or abort so they can create a worktree first. Do not silently continue on the main tree.

**2. Resolve a stable `OFFSET`.** The offset shifts the web port (`make dev OFFSET=N` → Next.js on `3000+N`). It must stay the same across re-invocations in this worktree, so persist it in the worktree's private git dir (per-worktree, never tracked):

```bash
offset_file="$git_dir/implement-offset"
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

Use this `offset` for every later `make dev`, port computation, and browser URL. Report the chosen offset + port to the user, and post it on the ticket so a parallel run is traceable.

**⚠️ Shared database.** All worktrees share the ONE remote dev Supabase project — there is no per-worktree DB. Consequences:
- **Never** run destructive db scripts (`npm run db:reset`, `db:fresh`, `db:restore`) from a parallel worktree while another run is active. If a task needs a DB reset, coordinate with the user first.
- Migrations pushed from one worktree are visible to all runs immediately. Sequence migration-bearing tickets rather than parallelizing them.
- Test data you create is visible to sibling runs; prefix identifiers where practical so cleanup is attributable.

**3. Capture a test baseline (before touching any code).** Some suites may already be red on `main`; you must not get blamed for — or have to manually disprove — pre-existing failures. Record the failing set *now*, while grounding/planning runs:

```bash
# Kick off in the background; stash the list of currently-failing tests.
make test > "$git_dir/implement-baseline.log" 2>&1 &
```

When you later run the full suite (pre-PR gate, Phase 4), diff against this baseline: a failure present in `implement-baseline.log` is pre-existing (note it, don't chase it); a failure *not* in the baseline is yours to fix. If the baseline is fully green, every later failure is attributable to this run.

---

## Step 0: Resolve the ticket

`$ARGUMENTS` is a Linear issue identifier (`CHUCK-123`) or a `linear.app` URL.

1. If it's a URL, extract the issue identifier from it.
2. If `$ARGUMENTS` is empty, call `list_issues` for the **Chuckbox** project, show the open/todo issues, and ask the user which to implement.
3. Call `get_issue` for the resolved ID. Capture: title, full description, acceptance criteria, labels, priority, current state, attachments, the **git branch name** Linear provides (use it verbatim in Phase 3), and the **parent / project** fields — these point at the epic (see step 4).
4. **Pull in the epic for full scope.** A ticket is almost always one slice of a larger epic; building it without the epic's context risks solving the slice in a way that fights the whole. Resolve the epic and load it:
   - **Parent issue** (the usual epic shape here — containers titled `Epic [A-Z] — …` carrying an `epic:*` label): if `get_issue` reports a `parent`, call `get_issue` on that parent ID. Capture its description, acceptance criteria, and any architectural framing. Then call `list_issues` filtered to that parent to enumerate the **sibling sub-issues** — this is the full epic breakdown, and tells you what's already built, in flight, or coming so you don't duplicate, collide with, or pre-empt sibling work.
   - **Project as epic:** if there's no parent but the issue belongs to a Linear **project** that represents the epic, call `get_project` for its overview/scope and `list_issues` for that project to see the sibling tickets.
   - **No epic:** if the ticket is genuinely standalone (no parent, no epic-bearing project), note that and proceed with just the ticket.
   - Record the epic's identity, goal, and the sibling-ticket list in your working notes — this becomes part of the grounding extract (Phase 1) and frames the ticket's scope boundaries (what's *this* ticket vs. what a sibling owns).
5. Call `list_comments` to read existing discussion — avoid re-deriving context that's already been settled there, and respect any direction the requester left.
6. Post an opening comment on the ticket: a short "🤖 Picked up via `/implement` — grounding against the docs now." so the requester knows it's in motion.

---

## Step 1: Load orientation

1. Read the top-level `CLAUDE.md` and `docs/CLAUDE.md` (doc system rules, role ownership, supersession, classification, commit style).
2. **Read `docs/glossary.md`** — Scouting/BSA and fund-accounting terminology has critical distinctions (billing_balance vs funds_balance, rank vs merit-badge requirements, unit vs troop/pack); load it before interpreting the ticket (project rule).
3. Read the top-level indexes you'll need to place the work: `docs/prd.md`, `docs/tech.md`, and `docs/testing.md`.
4. Determine which **feature folder** the ticket maps to by matching its intent against `docs/features/*/`. A ticket may map to one existing feature, span several, or be genuinely new. Note which.
5. Read the matched feature's `requirements.md`, `architecture.md`, `tests.md` (if present), and `tasks.md` (for the ID prefix + next-available numbers).

---

## Phase 1: Ground the ticket

Treat the ticket as raw client signal and run an autonomous distill-and-analyze pass (no separate triage checkpoint — the single gate is the plan).

1. **Distill** the ticket into the grounding-extract shape: decisions implied, new/changed requirements, technical signals, design signals, acceptance criteria, open questions. Drop conversational cruft. **Frame it inside the epic (Step 0):** state the epic's goal, where this ticket sits in it, and the scope boundary against sibling tickets (what this ticket owns vs. what a sibling owns). Flag if the ticket only makes sense alongside a sibling that isn't built yet, or if a sibling already established a pattern/contract this ticket must conform to.
2. **Analyze against the docs:**
   - Which active DRs constrain how this must be built? Scan the index of `docs/decisions/` and any DRs the matched feature's `architecture.md` cross-references.
   - Does anything in the ticket **conflict** with an active DR, an existing requirement, or a documented AC? Flag every conflict — these are decisions for the gate, not for you to silently resolve.
   - Does the ticket introduce a **meaningful choice between alternatives with consequences** (per `docs/CLAUDE.md` classification)? If so, it may warrant a DR. Flag it; recommend the user run `/decide` first rather than baking an un-recorded architectural decision into the build.
3. **Map each acceptance criterion to an observable check** — something verifiable by watching the app, not by inspecting the database (per the Acceptance Criteria Principle in `docs/CLAUDE.md`). These become the Verification Plan.

---

## Phase 2: Produce the ticket plan

Read the template at `${CLAUDE_SKILL_DIR}/ticket-plan-template.md`.

1. Write the plan to `docs/grounding/tickets/[TICKET-ID]-plan.md` (create `docs/grounding/tickets/` if absent). Fill every applicable section: summary, grounding extract, analysis (conflicts + DR-needed flags), task list, verification plan, screenshot plan (route + login role + what to capture), open questions.
2. **Add the tasks into the matched feature's `docs/features/[feature]/tasks.md`** — status "Not Started", using that feature's ID prefix and the next-available numbers, matching the existing table format and dependency conventions. `/execute`'s queue resolver must be able to read them natively. (If the ticket is a brand-new feature, scaffold the feature folder with at least `requirements.md` + `tasks.md` following the doc system; flag this in the plan.)
3. Keep tasks PR-sized and dependency-ordered. Business-logic tasks are TDD (tests first); infrastructure tasks verify via build + smoke.

### **GATE — STOP. Approve the plan.**

Present the full plan in chat. Surface conflicts and any DR-needed flag prominently. Also post a condensed plan summary (task list + verification plan + open questions) as a Linear comment so the requester sees the approach.

Ask: **"Approve this plan to implement, request modifications, or abort."**

**Do NOT proceed past this gate until the user explicitly approves.** If they request changes, update the plan (and the feature `tasks.md`) and re-present. If a conflict or DR-needed flag is unresolved, resolve it here — possibly by pausing to run `/decide` — before continuing.

---

## Phase 3: Execute the tasks

1. **Branch.** If already on a non-`main` branch (the common case — a dedicated git worktree per ticket), use it. Otherwise create/checkout the **Linear-provided branch name** (Step 0) off an up-to-date `main`. Never implement on `main`. Move the Linear ticket to its "In Progress" status (`save_issue`; resolve the status ID via `list_issue_statuses`).
2. Create one `TodoWrite` entry per queued task.
3. Run the **`/execute` per-task loop** for each task, in dependency order, in **auto mode** (chain without pausing between tasks — the gate already happened):
   - Mark the task "In Progress" in `tasks.md`; set the todo `in_progress`.
   - Plan → implement (TDD for business logic, build-and-smoke for infrastructure). Follow the DRs and project conventions. Database shapes come from the generated Supabase types (`src/types/database.ts`) — never hand-write row/insert types.
   - **Validate at task scope — keep it cheap.** `make lint`, then `npx tsc --noEmit`, plus the task's own vitest files (`npx vitest run <file>`). Invoke the `code-simplifier:code-simplifier` subagent on the changed files, then re-check. **Do not run a full `make build` or the whole suite per task** — the full Next.js production build plus the complete suite is minutes of wall-clock; that full gate runs *once* before the PR (Phase 4). Running it 5× across a ticket is the single biggest avoidable time sink.
   - **Types ordering exception.** A task that adds or changes a database migration must push the migration to the dev Supabase project and regenerate `src/types/database.ts` (`npx supabase gen types typescript --project-id <dev ref> > src/types/database.ts`) **before** any task that consumes the new shapes — otherwise the typecheck fails against stale generated types and looks like a phantom bug. Sequence migration tasks ahead of their consumers. Remember the Supabase safety rules in `CLAUDE.md`: dev project only; production pushes need explicit user approval.
   - Mark "Done", move the row to the Completed Tasks table with the date, set the todo `completed`.
   - Commit **only this task's files** (never `git add -A`), message: `[type]([scope]): [TASK-ID] [imperative description]`. Do not push yet.
4. **Keep the ticket updated as you go:** post a Linear comment at each meaningful milestone (per task, or per phase for large tickets) with the task ID + commit hash, and **call out every deviation from the approved plan** the moment it happens (a task that grew, an approach that changed, a new task you had to add).

If any validation step fails, follow **Failure handling** below — do not silently continue.

---

## Phase 4: Verify (inline — no separate skill)

Verification = the green build/lint/test loop from Phase 3 **plus** a functional smoke check against the acceptance criteria. **Prove the ACs by exercising the running app in an authenticated session; use a browser screenshot as *evidence of the final state*.** For server actions and API routes, targeted authenticated requests are faster and more reliable than driving every step through the UI — use the browser for what must be seen, requests for what must be proven.

1. **Run the full gate once.** Now — not per task — run `make build` (full Next.js production build, fails loudly on type errors) and the full `make test`. Diff failures against `implement-baseline.log` from Preflight: pre-existing failures are noted, not chased; new failures are yours. This is the single comprehensive build/typecheck/test gate for the whole ticket.
2. **Ensure local dev is up — use the offset pinned in Preflight.** Compute `WEB_PORT=3000+OFFSET`. Check whether `http://localhost:$WEB_PORT` responds; if not, start `make dev OFFSET=$OFFSET` in the background and poll until ready. The app talks to the shared dev Supabase project; the seeded test users (see the **Test User Credentials** table in `CLAUDE.md` — one login per role: admin, treasurer, leader, parent, scout) are your deterministic identities. Pick the role the ACs demand (a parent-facing AC must be verified as the parent user, not the admin).
3. **Verify the ACs in an authenticated session (primary).** Log in as the appropriate test user and exercise the actual behavior behind each AC. Two mechanics, use whichever fits each AC:
   - **Browser** (Playwright MCP or claude-in-chrome): drive the real route and observe the outcome.
   - **Authenticated requests:** mint a session the way `tests/e2e/global-setup.ts` does (Supabase REST password grant + chunked cookies) and hit the route/action directly — fast and deterministic for API-shaped ACs.
   Record AC → pass/fail from these checks.
4. **Capture screenshot(s) as evidence (secondary).** Navigate to the feature route as the right role and save to `docs/grounding/tickets/[TICKET-ID]-screenshots/[slug].png`. Capture more than one if multiple ACs need visual evidence.
5. Write the verify results (AC → pass/fail) into the ticket plan doc's Verification Plan, and post them as a Linear comment. **If any AC fails, treat it as a Phase-3 failure** — fix it (new task if needed) and re-verify; do not open the PR on a red AC.

### Verification playbook — Chuckbox gotchas

- **Middleware redirects abort navigation:** a direct `goto` to a protected route can throw `ERR_ABORTED` from the auth-redirect middleware — wrap navigation in try/catch or land on `/login` first (see `tests/e2e/` harness notes).
- **Wait for hydration:** snapshots taken pre-hydration miss interactive elements. Poll for a known control before asserting, rather than snapshotting immediately after navigation.
- **Feature flags are render-time:** `NEXT_PUBLIC_FEATURE_*` changes need a page refresh, not a rebuild — but the dev server must have been started with the env var set. If an AC lives behind a flag, confirm the flag state before declaring a failure.
- **Role matters:** nav links and page access vary by role (`src/lib/roles.ts`). "Element not found" as the wrong role is not a defect.
- **Shared dev DB:** any data you create during verification is visible to other sessions — clean up records you created, and never verify by wiping the database.

---

## Phase 5: Open the PR and finalize the ticket

1. **Push** the branch.
2. **Open the PR against `main`** with `gh pr create`:
   - Title: `[TICKET-ID] [concise feature title]`.
   - Body: what changed (task list with commit hashes), acceptance criteria verified (the AC→pass table), the screenshot(s), and a Linear close/link reference (e.g. `Fixes [TICKET-ID]` — Linear also auto-links via the branch name). Note any deviations from the approved plan and anything deferred. End the PR body with the standard `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.
3. **Put the screenshot on the Linear ticket — embed it INLINE, don't just attach it.** A screenshot only *displays* on the ticket if its asset URL is embedded as image markdown in a comment body. `create_attachment_from_upload` alone makes an attachment *row* (side panel / a bare link), which is why "see attached screenshot" looks like nothing is there. The reliable flow:
   1. `prepare_attachment_upload` (issue, filename, `contentType: image/png`, exact byte `size` from `stat -f%z`). It returns `assetUrl` + `uploadRequest {url, headers}` + a **60-second** expiry.
   2. **Immediately** `PUT` the raw bytes — do this in the very next step, no detours, or the signed URL expires (403). Send the signed headers verbatim:
      ```bash
      curl -sS -X PUT --data-binary @"$PNG" \
        -H "content-type: image/png" \
        -H "x-goog-content-length-range: <size>,<size>" \
        -w "%{http_code}\n" "<uploadRequest.url>"   # expect 200
      ```
      Don't base64 or transform the file; don't hand-edit the long signed URL (one corrupted char → 403).
   3. **Embed `assetUrl` in a comment** via `save_comment`: `![caption](<assetUrl>)`. Use the bare `uploads.linear.app/...` URL with no extension — Linear recognizes its own asset and auto-signs it for rendering. This is the step that makes the image visible.
   4. (Optional) also call `create_attachment_from_upload` if you want a formal attachment row too — but the inline embed is what the reader sees.

   Note: the committed PNG under `docs/grounding/tickets/.../` is in the branch, so the **GitHub PR** body can reference it by repo path; the `uploads.linear.app` URL is auth-gated and won't render on GitHub.
4. **Final Linear comment:** PR link, one-line summary, AC verification results, and a bulleted list of deviations from the plan. (Embed the verification screenshot here per step 3, or in its own comment.) Move the ticket to its "In Review" status (`save_issue`).
5. **Report to the user** in chat: branch, commits, PR URL, AC pass/fail summary, screenshot path(s), and any open questions still posted on the ticket.

---

## Failure handling

If any validation step (lint, build, test, or an acceptance-criterion check) fails:

1. **Stop the chain.** Do not advance to the next task.
2. Revert the failing task's status to "Not Started" (or "Blocked") in `tasks.md`. Roll back only clearly-broken uncommitted files with `git restore` on specific paths — **never** `git reset --hard`.
3. Diagnose: report the task, the step, the exact command output, and your read of the root cause — in chat **and** as a Linear comment so the failure is visible on the ticket.
4. Ask the user how to proceed: fix-and-retry, skip (mark Blocked), or stop the session. Do not retry the same failing command repeatedly without understanding why; do not destructively reset state to make an error disappear.

The pipeline is resumable: `tasks.md` reflects real status, the branch holds completed commits, and the ticket plan doc records where things stand.

---

## Principles

- **One gate, then trust the plan.** The approved plan is the contract. Don't quietly redesign mid-flight — if reality diverges, note the deviation on the ticket and, if it's large, stop and re-confirm.
- **The ticket is the journal.** Comments, deviations, verify results, and the screenshot all land on the Linear issue. Someone reading only the ticket should understand what was built and how it was proven.
- **Verify behavior, not internals.** ACs are checked by exercising the app, and the screenshot is the evidence. A feature isn't done until its observable criteria pass in a running browser.
- **Grounding before building.** Reconcile the ticket against the docs and DRs first. A ticket that conflicts with an active decision, or that smuggles in a new architectural choice, is a `/decide` conversation — not something to silently implement.
- **Scope stays tight.** Build what the ticket and plan ask for. Adjacent breakage becomes a new task, not a "while I'm here" edit.
