---
name: decide
description: Draft an architecture decision record, analyze its impact across the doc system, and execute downstream updates with human validation checkpoints
argument-hint: [decision topic or description]
allowed-tools: Read Write Edit Glob Grep Bash(ls *) Bash(mkdir *) Bash(git *) AskUserQuestion Agent
---

# Decision Pipeline

Create or update a Decision Record with structured impact analysis and execution. This skill runs a **three-phase pipeline** with human validation checkpoints — mirroring `/ground` but focused on architectural decisions rather than raw client signal.

**Core principle:** A decision record doesn't just change one file. Decisions cascade through the doc system — requirements, acceptance criteria, schemas, glossaries, and other decision records may all need updates. This skill makes that cascade visible and executable.

## Step 0: Determine Input

- If `$ARGUMENTS` is empty, ask the user: "What decision do you want to capture?"
- If `$ARGUMENTS` contains a topic or description, treat it as the decision context
- If the user references an existing DR by filename, load it for editing/superseding instead of creating new

## Step 1: Read Orientation

Read `docs/CLAUDE.md` to load the document hierarchy, supersession rules, and DR template.
Read the DR template at `${CLAUDE_SKILL_DIR}/dr-template.md`.
List existing DRs in `docs/decisions/` to check for related or superseded decisions.

---

## Phase 1: Draft the Decision

Work with the user to crystallize the decision. Produce a draft DR with:

1. **Title** — concise, captures the decision (e.g., "Unified Parties Table")
2. **Context** — the problem, constraints, what prompted this, what's been tried
3. **Decision** — what we're deciding, stated definitively
4. **Consequences** — trade-offs, what changes, what stays the same, risks

Write the draft to `docs/decisions/DR-YYYY-MM-DD-[topic-slug]-v[N].md` using the template.

### **CHECKPOINT 1 — STOP.**

Present the complete draft DR to the user. Display it in full.

Ask: "Does this DR accurately capture the decision? You can approve it, request edits, or reject it. Once approved, I'll analyze its impact across the doc system."

**Do NOT proceed to Phase 2 until the user explicitly approves the draft.**

---

## Phase 2: Impact Analysis

Scan the doc system to identify everything this decision affects. Produce an **impact report** (not a change plan — this is about identifying, not prescribing).

### 2a: Load the doc system

Read top-level docs: `docs/prd.md`, `docs/tech.md`, `docs/glossary.md`, `docs/plan.md`, `docs/testing.md`.
Read the current schema at `docs/schema.dbml`.
Read all feature requirements in `docs/features/*/requirements.md`.
Read all feature tests in `docs/features/*/tests.md`.
Read all existing DRs in `docs/decisions/`.

**For large doc systems, use parallel Explore agents** to efficiently scan:
- One agent for requirements files
- One agent for test files
- One agent for schema + top-level docs

### 2b: Identify impact categories

For each file/section affected, classify the impact:

- **CONFLICTS** — The DR contradicts existing content that must be corrected
- **STALE REFERENCES** — Content references removed/renamed entities, tables, or concepts
- **BEHAVIORAL ACS** — Acceptance criteria that describe behavior the DR changes (needs rewording)
- **IMPLEMENTATION-DETAIL ACS** — ACs that reference specific data models, table names, or FK columns the DR modifies. **These should be rewritten to be behavior-driven** (describe what users can do, not how it's stored).
- **SUPERSEDED DRS** — Prior DRs whose status needs updating
- **NEW OPPORTUNITIES** — Capabilities the decision unlocks that aren't covered by existing ACs — should add new ACs
- **DOWNSTREAM DOCS** — tech.md, glossary.md, prd.md, plan.md sections that describe the affected concept

### 2c: Produce the impact report

Write the report to `docs/decisions/impact-reports/DR-YYYY-MM-DD-[topic-slug]-impact-v[N].md` with sections:

```markdown
# Impact Report: [DR Title]

**DR:** docs/decisions/DR-YYYY-MM-DD-[topic-slug]-v[N].md
**Generated:** YYYY-MM-DD

## Summary
- Files affected: N
- ACs requiring updates: N
- ACs requiring behavioral rewording: N
- New ACs recommended: N
- Superseded DRs: N

## Conflicts
- [file:line] [description of conflict]

## Stale References
- [file:line] [what's stale]

## ACs Requiring Updates (by file)

### features/[feature]/tests.md
- **AC-NN:** [current text] → [recommended rewording — behavior-driven]

## New ACs Recommended
- **features/[feature]/tests.md:** [new AC description and rationale]

## Downstream Doc Updates
- **docs/tech.md:** [section] — [what changes]
- **docs/glossary.md:** [term] — [add/update/remove]
- **docs/schema.dbml:** [tables] — [changes]

## Superseded DRs
- DR-YYYY-MM-DD-[topic]-v[N] → Status: "Partially superseded — [what part]"
```

### **CHECKPOINT 2 — STOP.**

Present the complete impact report to the user. Display it in full.

Ask: "Approve this impact analysis to proceed with execution, request modifications, or abort. I will apply all listed changes exactly as documented."

**Do NOT proceed to Phase 3 until the user explicitly approves.**

If the user requests modifications, update the report and present again.

---

## Phase 3: Execute

Apply all approved changes in the impact report. Use parallel agents where the updates are independent (e.g., test file updates across features).

### 3a: Update the DR status
- If this is a new DR, leave as "Active"
- If it supersedes prior DRs, update their status to "Partially superseded by DR-[this one]" or "Fully superseded"

### 3b: Apply schema changes
Update `docs/schema.dbml` with any table additions, removals, or field changes from the impact report.

### 3c: Update requirements files
Apply all changes to `docs/features/*/requirements.md` listed in the impact report.

### 3d: Update test files
Apply all AC updates and additions to `docs/features/*/tests.md`. **Prefer behavior-driven language** — describe what users can observe, not how the system stores data.

### 3e: Update top-level docs
Update `docs/tech.md`, `docs/glossary.md`, `docs/prd.md`, `docs/plan.md` sections as identified.

### 3f: Verify
Run a grep pass to confirm no stale references to removed concepts remain.
Confirm the schema still parses (DBML-valid syntax).

### 3g: Commit
Create a git commit with a descriptive message:

```
docs: [DR topic] — [brief summary]

NEW DR: [filename]
  [one-line decision summary]

Impact applied:
  - [N schema changes]
  - [N requirement updates]
  - [N AC updates across M features]
  - [N new ACs added]
  - [N superseded DRs updated]

See docs/decisions/impact-reports/[filename] for full analysis.
```

Present the commit summary to the user.

---

## Principles

### Acceptance criteria should be behavior-driven

ACs that reference tables, columns, or data structures become brittle. When possible, rewrite them to describe observable behavior:

**❌ Implementation-coupled:**
> "Guarantors migrated as distinct entity type with dedicated loan_guarantors junction table, not via contacts table"

**✓ Behavior-driven:**
> "Guarantors from legacy data linked to loans as guarantor role associations, distinct from borrower and contact roles"

The second AC still verifies the same outcome, but survives schema refactoring.

### DRs are the record, impact reports are the worklist

The DR captures **why** and **what** we decided. The impact report captures **everything that had to change as a result**. Both are preserved — the DR in `docs/decisions/`, the impact report in `docs/decisions/impact-reports/`. This creates an audit trail: future readers can see both the decision and its consequences.

### Supersession is explicit

When a new DR partially or fully supersedes an older one, update the older DR's status line. Don't delete superseded content — it provides historical context. Use the changelog in both files.
