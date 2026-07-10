---
name: execute
description: Iterate through tasks in a feature's task list — run build/lint/simplify/test validation for each, update task status in place, and commit per task
argument-hint: [feature-slug] [task-scope e.g. PLATFORM-001..PLATFORM-005 | lane-A | group "Core Infrastructure"]
allowed-tools: Read Write Edit Glob Grep Bash Agent TodoWrite AskUserQuestion
---

# Task Execution Pipeline

Execute tasks from a feature's `tasks.md` file one at a time. For each task, run a disciplined validation loop — plan, implement, lint, simplify, build, test — and commit on success. Update task status in `tasks.md` as work progresses.

**Core principle:** One task = one commit = one PR-sized unit of work. Never bundle tasks. Never skip validation. Never expand scope beyond what the task asks for.

---

## Step 0: Parse arguments

`$ARGUMENTS` should contain a feature slug followed by an optional scope descriptor. Accept any of these shapes:

| Format | Meaning |
|--------|---------|
| `platform-foundation` | Execute all tasks with status "Not Started" in dependency order |
| `platform-foundation PLATFORM-001..PLATFORM-005` | Execute inclusive range |
| `platform-foundation PLATFORM-001,PLATFORM-005,PLATFORM-010` | Execute comma-separated list |
| `platform-foundation lane-A` | Execute tasks in the named parallelization lane |
| `platform-foundation phase-0` | Execute tasks in the named parallelization phase |
| `platform-foundation group "Core Infrastructure"` | Execute all tasks under a named group |

Be flexible. If the user writes something else, interpret it naturally and confirm with them before proceeding.

**If `$ARGUMENTS` is empty:**
1. List feature folders in `docs/features/` that contain a `tasks.md` file
2. Ask the user which feature to work on
3. Once a feature is selected, ask what scope

---

## Step 1: Load context

1. Read `docs/CLAUDE.md` for project conventions (commit style, doc system rules)
2. Read the top-level `CLAUDE.md` for project context
3. Read `docs/features/[feature]/requirements.md` for capability scope
4. Read `docs/features/[feature]/architecture.md` for technical design and DR references
5. Read `docs/features/[feature]/tasks.md` in full — this is the source of truth for what to execute
6. Skim any DRs the architecture file cross-references

---

## Step 2: Resolve the task queue

Parse `tasks.md` and extract tasks matching the user's scope.

**Validation rules:**
- All referenced task IDs must exist in the file
- All dependencies of selected tasks must be either (a) in the queue ahead of their dependent, or (b) already marked "Done" in `tasks.md`
- No task in the queue may currently be "In Progress" (would collide with another session)

**Dependency ordering:**
Topologically sort the queue so that each task's dependencies come first. If there's ambiguity (two tasks with no inter-dependency), preserve the file order.

**Produce a clean queue** — list of task IDs in execution order.

### **CHECKPOINT 1 — STOP**

Present the task queue to the user:

```
I'll execute these N tasks in order:

1. PLATFORM-001 — Initialize monorepo directory structure
2. PLATFORM-002 — Create docker-compose.yml for local PostgreSQL
3. PLATFORM-003 — Create root Makefile
...

Between each task I will:
  - Mark task "In Progress" in tasks.md
  - Plan and implement the change
  - Run linting
  - Invoke code-simplifier agent on changed files
  - Run build
  - Run tests where applicable
  - Mark task "Done" and move to Completed Tasks table
  - Commit with a descriptive message referencing the task ID

I will stop and ask for guidance if any validation step fails.

Proceed? [yes / no / modify]
```

**Do NOT start executing until the user explicitly confirms.**

Use `TodoWrite` to create one todo per task in the queue, all initially `pending`.

---

## Step 3: Execute the queue

Work through each task in order. **Never run two tasks concurrently in the same session.** If multiple things need to happen at once, that's a hint to re-scope the task.

For each task:

### 3a: Start the task

- In `docs/features/[feature]/tasks.md`, change the task's `Status` cell from "Not Started" to "In Progress"
- Update the TodoWrite entry for this task to `in_progress`
- Re-read the task's full row from the table: description, dependencies, verification criteria

### 3b: Plan

Think through what the task requires before touching any files:
- Which files need to be created or modified?
- What's the acceptance criterion — how will you know when it's done?
- Does this task have tests to write?
  - **Feature tasks (business logic):** follow TDD — write failing tests first, then code to make them pass. (Wade's preference, captured in auto-memory.)
  - **Infrastructure tasks (scaffolding):** tests may not exist yet — verification is the build and smoke check described in the task row.
- Are there DRs or architecture notes that constrain how this task should be done?

Keep scope tight. Don't refactor adjacent code. Don't add "while we're here" improvements.

### 3c: Implement

Make the changes the task requires.

- Use `Edit` for existing files, `Write` for new files
- Follow the project conventions from `CLAUDE.md` and the relevant DRs
- If the task involves .NET code, match the patterns in `DR-2026-04-10-core-project-architecture-v1` (vertical slices, `Feature.Query/Result/Handler` static classes, direct DbContext access, etc.)
- If the task involves the API layer, match `DR-2026-04-10-api-layer-pattern-v1` (REPR, one file per endpoint)
- If the task writes tests, use xUnit + FluentAssertions for .NET, Vitest for NextJS (per `docs/testing.md`)

### 3d: Validate

Run the validation loop. **If any step fails, stop.** Do not auto-retry without understanding why.

**1. Lint**
```bash
make lint
```
If `make lint` doesn't exist yet (the task that creates it may still be pending), skip this step and note it. Otherwise, the lint step must pass.

**2. Build**
```bash
make build
```
The build must pass. If it doesn't, read the error, diagnose, and either fix or stop and ask for guidance.

**3. Code simplification**
Invoke the `code-simplifier:code-simplifier` subagent on the files changed during this task. Pass the file list and ask for a simplification pass focused on:
- Removing speculative abstractions
- Trimming unused helpers
- Merging obvious duplication
- Keeping error handling minimal (only at boundaries)

Review the agent's suggestions. Apply them selectively — don't blindly accept a rewrite that misunderstands the task's intent.

**4. Re-build after simplification**
```bash
make build
```
If the simplifier's changes broke the build, roll them back and proceed without simplification.

**5. Test (conditional)**
```bash
make test
```
- If the task wrote tests: **required to pass**
- If the task is pure infrastructure and no tests touch the changed files: **skip with a note**
- If existing tests are broken by this task's changes: **stop** — this is a regression and needs the user's attention

### 3e: Mark task Done

- In `tasks.md`, change the task's `Status` from "In Progress" to "Done"
- Move the task's row into the "Completed Tasks" table at the bottom of `tasks.md`, appending the completion date
- Update the TodoWrite entry to `completed`

### 3f: Commit

Stage **only the files changed during this task** — never `git add -A`. Create a commit using a HEREDOC for message formatting.

Commit message format:

```
[type]([scope]): [TASK-ID] [brief imperative description]

[Optional body explaining what and why]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

`[type]` follows the project's commit style — `docs:`, `feat:`, `fix:`, `chore:`, `test:`. Infer from what the task produced.

Example:
```
chore(infra): PLATFORM-001 initialize monorepo directory structure

Add api/ and web/ placeholder directories, root .gitignore excluding
.NET build artifacts and node_modules, and an initial README scaffold.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Run the commit. Do **not** push.

Report the commit hash to the user.

### 3g: Continue or pause

- **Interactive mode (default):** Pause after each commit. Report status: "PLATFORM-001 committed as <hash>. Ready for next task (PLATFORM-002)? [yes / stop / skip]"
- **Auto mode:** Proceed immediately to the next task in the queue.

If the user pauses, exit cleanly — the task queue state is in `tasks.md` and can be resumed later.

---

## Step 4: Completion

When the queue is empty (or the user stops):

Report a summary:

```
Executed N tasks from [feature]:

Completed:
  - PLATFORM-001 → <hash>
  - PLATFORM-002 → <hash>
  - ...

Skipped:
  - PLATFORM-005 (reason)

Failed:
  - (none)

Task file: docs/features/[feature]/tasks.md — N tasks now marked Done
Branch: [branch name]  (X commits ahead of main)

Next suggested: [next uncompleted task in dependency order, if any]
```

---

## Failure handling

If a validation step fails during task execution:

1. **Stop immediately.** Do not proceed to the next task.
2. Mark the current task status back to "Not Started" in `tasks.md` (or "Blocked" if the user explicitly marks it so).
3. Roll back uncommitted changes if they are clearly broken (use `git restore` on specific files — never `git reset --hard`).
4. Report the exact failure to the user:
   - Which task
   - Which validation step
   - The command output
   - Your diagnosis of the root cause
5. Ask the user how to proceed:
   - Fix and retry
   - Skip this task (mark Blocked and move on)
   - Stop the entire session

**Do not retry the same failing command multiple times without understanding why.** Do not destructively reset state to "make the error go away."

---

## Principles

### One task, one commit

Never bundle multiple tasks into a single commit, even when they're related. If a change feels too small to be its own task, that's a sign the task list is too granular — note it and move on, don't merge tasks mid-execution.

### Do not expand scope

If the task says "create `Foo.cs`", create `Foo.cs` and nothing else. Improvements, refactors, and cleanups go into their own tasks. If you notice something broken outside the task's scope, add a new task at the end of the queue — don't fix it in the current task.

### Prefer simplicity

The code-simplifier agent runs as a mandatory pass before commit. Its job is to catch over-engineering. Don't fight its suggestions; they're aligned with the project's "minimal complexity" feedback (captured in auto-memory).

### Tests tell the story

For business logic tasks, tests come first (red-green TDD). For infrastructure tasks, the build and smoke checks are the tests. Either way, a task isn't done until its verification criterion passes.

### Trust the task file

`tasks.md` is the source of truth for what needs to happen and what's already done. Keep it accurate at all times. Don't guess at task status from git history — read the file.

### Pause gracefully

At any point, the user can say "stop." Exit cleanly. The next invocation of `/execute` picks up from where this one left off because `tasks.md` reflects reality.

### Parallelization is external

This skill runs one task at a time. If the user wants parallelism, they create git worktrees following the Parallelization Guide at the top of `tasks.md` and run `/execute` in each worktree independently. The skill itself does not spawn parallel workers.
