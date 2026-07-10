# Documentation System — Agent Orientation

## Document Hierarchy

```
Grounding Extracts
  ├─► DR ──► features/*/requirements.md | features/*/tests.md | features/*/architecture.md
  ├─► Direct edits ──► prd.md | tech.md | testing.md | glossary.md
  └─► Design updates ──► features/*/screens.md
```

Decision Records (DRs) are the single artifact type for all architectural, product, and scoping decisions. See `/decide` skill for the workflow.

Top-level docs are **hybrid**: standalone content (vision, stack, testing strategy) + feature index table. They are edited surgically, never regenerated.

## Role Ownership

| Role | Primary Files |
|------|---------------|
| Requirements Engineer | `prd.md`, DRs, `features/*/requirements.md` |
| Technical Engineer | `tech.md`, DRs, `features/*/architecture.md` |
| Design Engineer | `features/*/screens.md` (and `BRAND.md` at repo root) |

Cross-cutting: `testing.md` and `glossary.md` are updated by any role when grounding impacts acceptance criteria or domain terminology.

**Reference docs:** `glossary.md` (domain terminology — load before processing docs), `process.md` (tacit process conventions).

## Supersession Rules

- Only the **current** version of any DR lives in the working tree
- Superseded versions are deleted; git history is the archive
- Each decision record carries an inline **Changelog** section
- Filename: `DR-YYYY-MM-DD-[topic]-v[N].md`
- Commit: `docs: supersede DR-[topic]-v[N-1] with DR-[topic]-v[N] — [reason] [date]`

## Grounding Flow (`/ground` skill)

1. **Distill** — Raw signal (transcript, email, spec, user feedback) is distilled into a structured extract in `grounding/extracts/`
2. **Triage** — Classify each signal: feature-scoped (which feature?) or cross-cutting. Identify affected roles.
3. **Change Plan** — Propose updates organized by role. Detect conflicts with active decisions. Determine: new decision record, supersession, direct edit, or feature file edit.
4. **Approve** — Human reviews the change plan. Resolves conflicts, answers open questions.
5. **Execute** — Apply approved changes. Create/supersede records, update feature files, update top-level docs. Commit with descriptive message.

## Decision Flow (`/decide` skill)

Decisions cascade through the doc system. The `/decide` skill enforces a three-phase pipeline so downstream updates don't drift:

1. **Draft** — Work with the user to write the DR (context, decision, consequences, trade-offs). Save to `decisions/DR-YYYY-MM-DD-[topic]-v[N].md`. **CHECKPOINT.**
2. **Impact Analysis** — Scan the entire doc system (schema, requirements, tests, glossary, other DRs) and produce an impact report at `decisions/impact-reports/DR-YYYY-MM-DD-[topic]-impact-v[N].md`. The report lists: conflicts, stale references, ACs requiring updates, ACs needing behavioral rewording, new ACs to add, downstream doc updates, superseded DRs. **CHECKPOINT.**
3. **Execute** — Apply all approved changes atomically. Update DR status on any superseded records. Commit with a descriptive message referencing the impact report.

**Use `/decide` whenever a change**:
- Adds, removes, renames, or restructures schema tables
- Changes entity relationships or cardinality
- Introduces a new architectural or product pattern
- Changes a concept that's referenced in multiple feature requirements
- Makes a product scope decision that will cascade through the docs
- Supersedes or contradicts a prior DR

## Execution Flow (`/execute` skill)

Tasks in a feature's `tasks.md` are the unit of executable work. The `/execute` skill iterates through a scoped set of tasks and runs a disciplined validation loop for each:

1. **Parse scope** — Accepts a feature slug plus optional scope: task ID, range, group name, lane, or phase. Empty scope means "all Not Started tasks in dependency order."
2. **Resolve queue** — Build a dependency-ordered task queue. Validate that dependencies are satisfied. **CHECKPOINT.**
3. **Execute each task** — For every task in turn:
   - Mark status "In Progress" in `tasks.md`
   - Plan and implement the change (TDD for feature work, build-and-smoke for infrastructure)
   - Run `make lint`, `make build`
   - Invoke the `code-simplifier` subagent on changed files; re-build after changes
   - Run `make test` (required if the task wrote tests; skipped for infrastructure tasks with no test coverage)
   - Mark status "Done" and move the row to the Completed Tasks table
   - Commit with a message referencing the task ID
4. **Continue or pause** — Interactive mode pauses between tasks; auto mode chains through.
5. **Report** — Summary of completed, skipped, and failed tasks at the end.

### Parallelization and git worktrees

Each feature's `tasks.md` includes a **Parallelization Guide** at the top, organizing tasks into phases (sequential) and lanes (parallel within a phase). Lanes are designed to be worktree-sized, independent units with minimal cross-lane file conflicts.

Typical parallel execution flow:
1. Complete a phase on `main` using `/execute`
2. Create one git worktree per lane of the next phase (`git worktree add ../wt-lane-a -b feature/lane-a`)
3. Run `/execute [feature] lane-A` inside each worktree
4. Merge lanes back to `main` at the phase boundary
5. Repeat for the next phase

The skill itself does not manage worktrees or parallelism — it runs one task at a time in the directory it's invoked from. Parallelism is a human + worktree workflow that the skill supports.

**Chuckbox caveat:** all worktrees share the ONE remote dev Supabase database. Lanes that touch migrations or run destructive db scripts (`db:reset`, `db:fresh`, `db:restore`) must NOT run in parallel — sequence them.

**Use `/execute` whenever you want to:**
- Work through a feature's task list without manual validation each step
- Make forward progress on a lane in a git worktree
- Kick off a batch of tasks and review commits at the end

## Acceptance Criteria Principle

**ACs should describe observable behavior, not implementation details.** An AC that references table names, FK columns, or storage layouts becomes brittle to refactoring — it fails for the wrong reasons when the schema evolves.

**❌ Implementation-coupled:**
> "Payments stored in payments table with journal_entry_id FK and paid_amount column"

**✓ Behavior-driven:**
> "Recording a payment reduces the scout's amount owed and appears in the account's transaction history"

When drafting ACs: ask "could I verify this criterion by watching a user interact with the system, without looking at the database?" If the answer is no, it's probably too implementation-coupled.

## Pseudo-Features

Some work is cross-cutting infrastructure rather than user-facing capability but still benefits from the standard feature file structure. These are called **pseudo-features** and live in `features/` alongside real features.

Current pseudo-features:

- **platform-foundation** — delivery infrastructure and cross-cutting hardening: Makefile verbs, git hooks, CI, the doc-system installation itself, migration/schema hygiene, monitoring, auth-helper consolidation. Not user-facing. See `features/platform-foundation/`.

A pseudo-feature's `requirements.md` describes platform capabilities (what the scaffolding provides to feature work) rather than user-observable acceptance criteria. Its `architecture.md` typically indexes the authoritative DRs rather than restating them. Its `tasks.md` is the concrete work list.

Create a pseudo-feature when cross-cutting work has a coherent scope, a lifecycle beyond initial setup, and benefits from the requirements/architecture/tasks triad. Do not create one for one-off chores or tiny utilities.

## Classification Guidance

**Create a DR when:** The decision represents a meaningful choice between alternatives with consequences that might be revisited. If someone would ask "why did we do it this way?" — record it. DRs cover both architecture and product decisions — no separate ADR/PDR split.

**Direct edit when:** The change is a clarification, minor adjustment, or uncontroversial factual update. No deliberate choice between alternatives.

**Feature-scoped:** Signal that affects a single feature's requirements, architecture, screens, or acceptance criteria. Route to the feature folder.

**Cross-cutting:** Signal that affects global constraints, conventions, stack decisions, or multiple features. Route to top-level docs.

## File Size Rules

- Target: **~400 lines** max per file
- Top-level docs: **~100-150 lines** (lean indexes)
- When a file exceeds ~400 lines, decompose into feature-scoped sub-files
- CLAUDE.md files: **~150 lines** max

## DR Template

```markdown
# DR: [Topic] v[N]

**Date:** YYYY-MM-DD
**Status:** Active | Superseded | Proposed | Deprecated
**Supersedes:** [prior version filename if applicable]
**Affects Features:** [list of feature folders]

## Decision
[What we decided and why]

## Context
[Background, constraints, alternatives considered]

## Consequences
[Tradeoffs, risks, follow-on work]

---
## Changelog
- **v[N] (YYYY-MM-DD):** [What changed from prior version]
```

## Grounding Extract Template

```markdown
# Grounding Extract: [Source Description]

**Date:** YYYY-MM-DD
**Source:** [User feedback / Pilot-troop signal / Spec document / etc.]
**Participants:** [Names if relevant]

## Decisions Made
- [Concrete decisions agreed to]

## New Requirements
- [New features, capabilities, or constraints]

## Changed Requirements
- [Modifications to previously understood requirements]

## Technical Signals
- [Stack preferences, integration constraints, performance requirements]

## Design Signals
- [UI/UX preferences, brand guidance, accessibility requirements]

## Acceptance Criteria / Testing Signals
- [Expected behaviors, validation rules, edge cases, test requirements]

## Open Questions
- [Unresolved items needing follow-up]
```

## Change Plan Template

```markdown
# Change Plan: [Extract Source]

**Generated:** YYYY-MM-DD
**Source Extract:** grounding/extracts/[filename]

## Conflicts Detected
- [Conflicts with existing decisions requiring human decision]

## Proposed Changes

### Requirements (Requirements Engineer)
- [ ] [NEW DR | UPDATE file — description]

### Technical (Technical Engineer)
- [ ] [NEW DR | SUPERSEDE | UPDATE file — description]

### Design (Design Engineer)
- [ ] [UPDATE file — description]

### Testing
- [ ] [NEW | UPDATE features/[feature]/tests.md — acceptance criteria description]
- [ ] [UPDATE testing.md — strategy or index changes]

### Tasks Impact
- [ ] [NEW | MODIFIED | RESEQUENCE — description]

## Open Questions for Client
- [Ambiguities surfaced]
```
