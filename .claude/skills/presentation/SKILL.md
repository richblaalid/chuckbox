---
name: presentation
description: Generate the recurring product-update slides — a full bullet list of everything tackled, ACCOMPLISHMENTS (what shipped since a given date), and OUR CURRENT FOCUS (what's next) — drawing on Linear (primary source of truth for features) and git history
argument-hint: [date phrase | YYYY-MM-DD]
allowed-tools: Read Bash(git *) Bash(ls *) Bash(grep *) Bash(wc *) Bash(awk *) Bash(sed *) Bash(python3 *) Glob Grep AskUserQuestion ToolSearch mcp__linear-chuckbox__list_issues mcp__linear-chuckbox__list_projects mcp__linear-chuckbox__list_teams mcp__linear-chuckbox__list_cycles
---

# Presentation Slide Generator

Produce the recurring Chuckbox product update, in the exact format the team has standardized on:

0. **BULLET LIST** — a complete, grouped list of everything tackled in the window (delivered first; see Step 2.5). In a high-velocity feature-delivery phase, this is the most-requested output: the reader wants to see breadth, not just four headline numbers.
1. **ACCOMPLISHMENTS** — the headline slide: a lead paragraph, a hook subtitle, and four metrics
2. **OUR CURRENT FOCUS** — what we're working on next, drawn from Linear

All three follow strict formatting conventions captured below. Match them exactly — the format has been iterated on with the user and small deviations get rejected.

**Source-of-truth hierarchy:** Linear (`CHUCK-*` issues, organized into `epic:*`-labeled epics whose container issues are titled `Epic [A-Z] — …`) is the **primary** source of truth for *which features started/shipped and what's next*. Git is the source of truth for *quantitative metrics* (routes, tests, commits, migrations) and for catching infra/tooling work that never gets a ticket. Read feature-level `docs/features/*/tasks.md` only to enrich detail, never as the authority on status.

---

## Step 0: Resolve the Date

Parse `$ARGUMENTS` into a concrete `YYYY-MM-DD` start date:

- **Empty** — ask the user: "Which date should I summarize from? (e.g., 'last Wednesday', '2026-04-22', 'a week ago')"
- **Relative phrase** ("since last Wednesday", "a week ago", "yesterday") — resolve against today's date (read from the system context). Always show the user the resolved absolute date so they can confirm or correct.
- **Absolute date** — use as-is.

**Always state the resolved date before running git queries**, e.g. "Summarizing commits since 2026-04-22 (last Wednesday)."

---

## Step 1: Gather Git Signal

Run these in parallel:

```bash
git log --since="YYYY-MM-DD" --pretty=format:"%h %ad %s" --date=short
git log --since="YYYY-MM-DD" --oneline | wc -l
```

Then identify the commit range and pull stats:

```bash
# First commit in range (oldest)
FIRST=$(git log --since="YYYY-MM-DD" --pretty=format:"%h" --reverse | head -1)
# Latest commit
LAST=$(git log --since="YYYY-MM-DD" --pretty=format:"%h" | head -1)

git diff ${FIRST}~1..${LAST} --shortstat
git diff ${FIRST}~1..${LAST} --stat | tail -5
git diff ${FIRST}~1..${LAST} --diff-filter=A --name-only
```

Extract:
- Commit count
- Insertions / deletions / files changed
- New files added (especially routes, actions, tests, migrations, components)

If the range spans many commits, also identify **the dominant theme** by reading commit subject lines — commit subjects carry the `CHUCK-NNN` ticket and the scope; the prefix tells you the workstream.

---

## Step 1.5: Gather Linear Signal (primary source of truth for features)

Git tells you *what code landed*; Linear tells you *which product capabilities started and shipped, and what's queued next*. Pull both — they reconcile each other.

Fetch issues updated in the window (use an ISO-8601 duration relative to today, e.g. `-P4D` for the last 4 days; widen if the window is longer):

```
mcp__linear-chuckbox__list_issues(updatedAt="-P<N>D", limit=100, orderBy="updatedAt")
```

The result is large and is written to a tool-results file. Parse it with `python3` (the raw call will exceed the token limit — do not try to read it inline). Bucket by timestamp against the cutoff:

```python
import json
d = json.load(open("<tool-results-file-path>"))
cut = "YYYY-MM-DD"
def after(ts): return ts and ts[:10] >= cut
def epic(i): return ",".join(l.split(":")[1] for l in i.get("labels",[]) if l.startswith("epic:")) or "-"
completed, started, queued = [], [], []
for i in d["issues"]:
    row = (i["id"], i["status"], epic(i), i["title"])
    if after(i.get("completedAt")):   completed.append(row)
    elif after(i.get("startedAt")):   started.append(row)
    else:                             queued.append((i["updatedAt"][:10],)+row)
```

**Critical nuance — In Review can mean shipped.** If merged PRs move tickets to **In Review** rather than Done, Linear leaves `completedAt` empty for them, so `completedAt`-based "completed" can read **0** even in a heavy delivery week. Treat issues whose `startedAt` is in the window **and** whose status is `In Review` / `Done` as *shipped this week*. Cross-check against the `CHUCK-NNN` tickets in the git commit subjects — anything that has a merged commit shipped, regardless of Linear status. (This mirrors the `/epic-progress` skill, which counts Done **and** In Review as complete. If this workspace's GitHub integration auto-moves tickets to Done on merge, the cross-check simply confirms rather than corrects.)

**For the focus slide**, read the `queued`/`Backlog` issues — especially recently-updated ones, grouped by epic — to see what's genuinely next. The `/epic-progress` skill is a useful companion for per-epic % complete if the deck wants a progress graphic.

---

## Step 2: Quantify the Work

Pick metrics that match the workstream. Common patterns:

**For backend/feature work (actions/routes/tests):**
- New API routes / server actions — `git diff ... --diff-filter=A --name-only | grep -E "src/app/(api/.*route\.ts|actions/.*\.ts)$" | wc -l`
- Test cases added — `grep -hE "^\s*(it|test)\(" <new/changed test files> | wc -l`
- Tasks shipped — count `CHUCK-NNN` / feature-task-ID references in commit subjects
- Migrations landed — `git diff ... --diff-filter=A --name-only | grep -c "supabase/migrations/"`

**For data / import work:**
- Records imported, run time, match accuracy

**For frontend work:**
- Pages shipped, components added, screens wired

Always pick **4 numbers** for the ACCOMPLISHMENTS slide. They should be different orders of magnitude when possible — a mix tells a richer story than four counts of the same kind of thing.

---

## Step 2.5: Build the Bullet List (deliver this first)

In a high-velocity feature-delivery phase, the reader wants to see the full breadth of what was tackled — not just four headline numbers. Produce a complete, **grouped** bullet list before the two formatted slides.

Build it by reconciling the two signals from Steps 1 & 1.5:
- **Linear** gives the product-capability framing and the epic grouping (e.g. "Epic A — Financial Integrity"). Use the shipped issues (`startedAt` in window + In Review/Done) as the spine.
- **Git** fills in the work that never got a ticket — substrate/refactors, tooling, infra, dependency hygiene, docs/DRs — plus confirms which tickets actually merged.

Format:
- A one-line header: total commits + count of stories shipped/in-review.
- Then `**Group header**` lines (one per epic or theme), each followed by sub-bullets of concrete capabilities. Reference `CHUCK-NNN` IDs in parentheses where they add traceability — but keep each bullet a readable, user-observable capability, not a raw commit subject (triage at story level).
- Include a **Tooling / dev infra** group at the end for the ticketless work — it shows real effort that the slides otherwise hide.

Keep bullets concrete and outcome-shaped ("Treasurer can void a payment and see the ledger reverse in place"), not implementation notes. This list is the richest artifact; the two slides are distillations of it.

---

## Step 3: Identify the Theme + Subtitle

The accomplishment paragraph and the hook subtitle are the most important parts. Rules:

**Lead paragraph (1–2 sentences):**
- Name the workstream concretely (e.g., "Financial integrity hardening across the payment paths")
- State *why* it matters — what downstream work it unblocks or what it proves
- Avoid jargon that won't land with the reader; explain feature codes if used

**Hook subtitle (one line, em-dash construction):**
- Pattern: `From [prior state] to [new state] — in [time frame]`
- **Be honest about the prior state.** Don't say "empty schema" if entities already existed. Don't say "from scratch" if there was a prototype. Check the prior accomplishments slide if available, or ask the user.

---

## Step 4: Format the ACCOMPLISHMENTS Slide

Output exactly this structure (one blank line between every block):

```
## ACCOMPLISHMENTS

[Lead paragraph — 1–2 sentences explaining what was done and why it matters.]

[Hook subtitle — single line, em-dash construction]

[number 1] — [label 1 — 2–3 words]

[number 2] — [label 2 — 2–3 words]

[number 3] — [label 3 — 2–3 words]

[number 4] — [label 4 — 2–3 words]
```

**Hard rules — these have been corrected by the user before:**
- Metric labels are **2–3 words max**, not full sentences. ("Billing tasks shipped" ✓ — "Billing tasks shipped end-to-end on 2026-04-24, closing the entire payment spine" ✗)
- Each metric is **`number — label`** on a single line (em-dash separator). Number and label belong together, not in separate stacked groups.
- Numbers are bare (no units inline). Units belong in the label if needed.
- One blank line between every metric (the slide tool treats each line as a layout cell).

---

## Step 5: Identify the Two Focus Tracks

For OUR CURRENT FOCUS, pick **two distinct workstreams** that are actually next. Source them from **Linear** (Step 1.5):

- The `queued`/`Backlog` `CHUCK-*` issues from Step 1.5, grouped by epic and sorted by recent `updatedAt` — recently-groomed backlog clusters are the real "next."
- Prefer tracks with **strong continuity** to what just shipped (e.g. a substrate that landed this week now gets its user-facing workflow built on top). That continuity is the story.
- `docs/features/*/tasks.md` — read only to enrich detail on a chosen track, never as the authority on status.

**Hard rule — these have been corrected by the user before:**
- The two tracks must be **genuinely distinct**. "UI implementation" and "IA validation through real data" are too similar — they're the same work described two ways. A good second track is a *different feature area* entirely (e.g., a backend feature kicking off, a data pipeline, a new business workflow).
- Default pattern that works: **Track 1 = the visible/UI thrust the user describes; Track 2 = the next backend or data workstream from the task list.**

If the user provides explicit guidance on what one or both tracks should be, honor it exactly. Otherwise propose tracks and let them redirect.

---

## Step 6: Format the OUR CURRENT FOCUS Slide

```
## OUR CURRENT FOCUS

[Title — short phrase capturing both tracks together, e.g. "From Visual Prototype to Implemented UI"]

[Track 1 header — short phrase, 3–6 words]

[Track 1 paragraph — 2–4 sentences. State what we're doing, what the next concrete steps are, and what it proves or unblocks. Avoid restating the same idea in different words.]

[Track 2 header — short phrase, 3–6 words]

[Track 2 paragraph — 2–4 sentences. Same shape as track 1.]
```

**Hard rule:** Each track header sits **directly above its own paragraph**. Do not stack both headers together followed by both paragraphs — that breaks the visual pairing.

**Paragraph voice:**
- First-person plural ("We're moving...", "We're scoping...")
- Concrete next steps, not vague aspirations
- Tie back to the feature work when possible — show continuity with the accomplishments slide

---

## Step 7: Present and Iterate

Output all three artifacts in one message, **in this order**: (1) the grouped bullet list, (2) the ACCOMPLISHMENTS slide, (3) the OUR CURRENT FOCUS slide. The bullet list leads because in the current delivery phase it's the most-requested view of breadth; the two slides are distillations of it.

The user will likely iterate on:
- Subtitle wording (especially the "from X to Y" prior state)
- Metric label tightness
- Whether the two focus tracks are distinct enough
- Choice of second focus track
- Bullet grouping / which ticketless work to surface

Apply edits and re-present. Do not lecture about the format rules — just produce and adjust.

---

## Reference: Format Examples

These are format examples from a prior project (loan-servicing domain) — study the *shape* (bullet density, story-level altitude, metric mix), not the content:

**ACCOMPLISHMENTS — data-import spike:**
> Invoice calculations development using actual client loan data. This work will enable the creation and validation of the data model for invoicing and reporting.
>
> From spreadsheet to structured data — in one afternoon
>
> 203 / 27,355 / 7 / 3
>
> Loans hydrated end-to-end / Records imported / Seconds to run / Line items match to the penny

**ACCOMPLISHMENTS — entity-spine week:**
> Portfolio & entity-management spine development against the live client entity model. This work stands up the relational backbone that every downstream feature reads from and writes to.
>
> From bare entities to a fully-walkable loan portfolio — in a single working day
>
> 17 / 29 / 164 / 7
>
> Spine tasks shipped / New HTTP endpoints / Integration tests added / Entity domains live

**OUR CURRENT FOCUS — two-track example:**
> Model Validation and Data Ingestion
>
> Data model validation via invoices / Import pipeline
>
> [paragraph on round-tripping real data into entities and matching a reference invoice line-for-line]
> [paragraph on the import tool, real-data iteration, and measuring against the legacy system]
