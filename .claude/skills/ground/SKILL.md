---
name: ground
description: Process raw client signal into structured documentation — distill, analyze, and execute changes through the grounding pipeline
argument-hint: [raw signal text | path/to/file]
allowed-tools: Read Write Edit Glob Grep Bash(ls *) Bash(mkdir *) Bash(git *) AskUserQuestion
---

# Grounding Pipeline

Process raw client signal (transcripts, emails, specs, feedback) into the structured documentation system. This skill runs a three-phase pipeline with human validation checkpoints between each phase.

## Step 0: Determine Input

- If `$ARGUMENTS` looks like a file path (contains `/` or `.md`), read that file as raw input
- If `$ARGUMENTS` contains substantial text, treat it as inline raw input
- If `$ARGUMENTS` is empty, scan `docs/grounding/raw/` for files. If multiple exist, list them and ask the user which to process.
- If no input is found anywhere, ask the user to provide input.

## Step 1: Read Orientation

Read `docs/CLAUDE.md` to load the document hierarchy, role ownership, supersession rules, classification guidance, and templates.

Read the extract template from `${CLAUDE_SKILL_DIR}/extract-template.md`.

## Phase 1: Distillation

Strip conversational cruft and organize the raw signal into a structured grounding extract:

1. Identify the source metadata: date, source type (client call, email, spec, etc.), participants
2. Classify each piece of signal into the extract sections:
   - **Decisions Made** — Concrete decisions agreed to
   - **New Requirements** — New features, capabilities, or constraints introduced
   - **Changed Requirements** — Modifications to previously understood requirements
   - **Technical Signals** — Stack preferences, integration constraints, performance requirements
   - **Design Signals** — UI/UX preferences, brand guidance, accessibility requirements
   - **Acceptance Criteria / Testing Signals** — Expected behaviors, validation rules, edge cases, test requirements
   - **Open Questions** — Unresolved items needing follow-up
3. Write the extract to `docs/grounding/extracts/YYYY-MM-DD-[source-slug].md` using the template format
4. If the raw input came from `docs/grounding/raw/`, note the source file path in the extract metadata

### **CHECKPOINT 1 — STOP. Triage Pass.**

Present the extract structurally to the user (link + section/bullet counts). Then conduct a bullet-by-bullet **triage pass** to validate each finding before moving to Phase 2.

#### Triage cadence

Ask the user which cadence they prefer:

1. **Bullet-at-a-time** — most precise, slowest.
2. **Sub-area-at-a-time** (default) — present a small named cluster (e.g., a sub-heading within New Requirements) and let the user mark each bullet, refine the cluster, or accept all.
3. **Section-at-a-time** — fastest, coarsest. User reads the whole section and calls out which bullets need attention.

Honor user changes to cadence at any point during the pass.

#### Per-finding verbs

For each bullet, the user chooses one of:

- **Confirm** — keep as-is; eligible for the Phase 2 change plan.
- **Remove** — drop; not a real finding (misheard, overgeneralized, duplicate, or contradicted by another decision).
- **Refine** — propose a collaborative edit, then re-decide on the refined version. Never auto-confirm refinements; present the proposed wording and ask the user to confirm or refine again. Iterate as many times as needed.
- **Defer** — real but out of scope for this build OR blocked on more discovery. Move to `docs/future-phases/backlog.md`.

When a user says only "Confirm" on a finding flagged as covered/redundant by an earlier triage decision, follow the convention established earlier in the same pass — typically remove from the current location with a note that it's covered elsewhere.

When flagging redundancy proactively (e.g., "Note: covered by Invoicing #6"), include the cross-reference inline so the user can decide quickly.

#### Deferral handling

When deferring, append an entry to `docs/future-phases/backlog.md` under the appropriate topic section. Use the template at `${CLAUDE_SKILL_DIR}/future-phase-template.md`. If `docs/future-phases/` does not yet exist, create it and seed `backlog.md` with the topic-section scaffolding from the template.

#### Open questions surfaced during triage

If a refinement resolves direction but leaves details open, surface the residual ambiguity as a new open question. Append to **two** places:

1. The extract's own **Open Questions** section.
2. The cross-extract `docs/grounding/open-questions.md` living doc, under the **Open** section. If `open-questions.md` does not exist, create it.

When a question is later resolved (in change-plan, by a future grounding cycle, or by stakeholder answer), move it from **Open** to **Resolved** in `open-questions.md` rather than deleting — record the resolution path.

#### After triage

Once every finding has been triaged:

1. **Rewrite the extract file in place** to reflect all confirmations and refinements; drop removed bullets; drop deferred bullets (they live in the backlog now). Preserve original section structure. If a section ends up empty, leave a short pointer to the backlog rather than an empty stub.
2. **Append any new open questions** to `docs/grounding/open-questions.md`.
3. **Present the final tally to the user** (counts of confirmed / removed / deferred / new open questions; backlog entries created; new concepts introduced).
4. **Confirm with the user** that the rewritten extract reads correctly before moving to Phase 2.

**Do NOT proceed to Phase 2 until the user explicitly approves the post-triage extract.**

---

## Phase 2: Analysis & Change Plan

Read the change plan template from `${CLAUDE_SKILL_DIR}/change-plan-template.md`.

### 2a: Load Context

1. Read top-level indexes: `docs/prd.md`, `docs/tech.md`, `docs/screens.md`, `docs/design-system.md`, `docs/testing.md`
2. Read `docs/plan.md` and `docs/tasks.md` for current execution state
3. From the extract, identify which features are affected
4. Load only the relevant feature folders (`docs/features/[feature]/`)
5. Load any active decision records that might conflict (`docs/decisions/adr/`, `docs/decisions/pdr/`)

### 2b: First-Run Detection

If the feature index tables in prd.md and tech.md are empty (no data rows), this is a first grounding. Note:
- All operations will be "NEW" (no conflicts to detect)
- New feature directories may need to be created
- Top-level docs will transition from [TBD] placeholders to real content

### 2c: Analyze and Classify

For each piece of signal in the extract:

1. **Classify scope:** Feature-scoped (which feature?) or cross-cutting?
2. **Identify affected roles:** Requirements Engineer, Technical Engineer, Design Engineer
3. **Determine update type:**
   - New DR — significant decision between alternatives with consequences
   - Supersession — contradicts or evolves an existing active decision record
   - Direct edit to top-level doc — clarification, minor adjustment, factual update
   - Feature file edit — scoped change to requirements.md, architecture.md, screens.md, or tests.md
4. **Detect conflicts** with existing active decision records
5. **Identify acceptance criteria** — new or changed criteria to capture in feature tests.md
6. **Identify task impact** — new tasks, modified tasks, resequencing needed

### 2d: Produce Change Plan

Generate a change plan organized by role, following the change plan template. Include:
- Conflicts detected (with explanation and options)
- Proposed changes grouped by Requirements / Technical / Design / Testing
- Task impact (new, modified, resequenced)
- Open questions for client (ambiguities surfaced during analysis)

### **CHECKPOINT 2 — STOP.**

Present the complete change plan to the user. Display it in full.

Ask: "Approve this change plan to proceed with execution, request modifications, or abort."

**Do NOT proceed to Phase 3 until the user explicitly approves the change plan.**

If the user requests modifications, update the plan and present again for re-approval.

---

## Phase 3: Execution

Execute each approved item in the change plan in dependency order:

### 3a: Decision Records
1. Create new DR files in `docs/decisions/` with proper versioning
2. For supersessions: create the new version, delete the old version, update the inline changelog

### 3b: Feature Files
1. Create new feature directories if needed (`docs/features/[feature]/`)
2. Create or update `requirements.md`, `architecture.md`, `screens.md`, `tests.md`, `tasks.md` within affected feature folders
3. When creating or updating `tests.md`, use the template from `${CLAUDE_SKILL_DIR}/tests-template.md`. Derive acceptance criteria from requirements — each requirement should map to at least one criterion.

### 3c: Top-Level Docs
1. Apply surgical edits to `prd.md`, `tech.md`, `screens.md`, `design-system.md`, `testing.md`:
   - Update feature index table rows (add new rows, update status)
   - Edit standalone sections (replace [TBD] with real content, update existing content)
   - **Never rewrite entire files** — targeted edits only

### 3d: Planning Docs
1. Update `docs/plan.md` if wave structure or dependencies changed
2. Update `docs/tasks.md` (global index) with new or modified tasks
3. Update feature-level `tasks.md` files

### 3e: Commit
Create a git commit with a descriptive message:

```
docs: process grounding extract YYYY-MM-DD-[source-slug]

  - [LIST each action: NEW, SUPERSEDE, UPDATE with file and brief description]
```

Present the commit summary to the user.
