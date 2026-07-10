# Process Conventions

Tacit conventions of the development method — things that live in team habit elsewhere and are written down here because this project has no memory of them. The doc-system rules themselves are in `docs/CLAUDE.md`.

## DR implementation tracker pattern

When a DR produces build work, structure it in Linear as:

- **One parent tracker ticket** titled `[DR topic] (implementation)` — carries the DR link and the overall done-when.
- **`L-N` lane child tickets** (`L-1`, `L-2`, …), each sized for one git worktree. Each lane ticket's body has four sections:
  - **Build:** what this lane produces
  - **From:** the DR/spec sections and feature docs it derives from
  - **Dep:** lanes or tickets it depends on
  - **Done-when:** the observable completion criteria
- Lanes map 1:1 to the Parallelization Guide lanes in the feature's `tasks.md`.

## Task ID discipline

- Every feature `tasks.md` owns an ID series (`PLATFORM-001…`, `BILLING-001…`). IDs are never reused.
- The file header states the **next free ID**. When you claim a range (e.g. for a plan gate), update the header immediately — even before the tasks land.
- If a collision slips through (two branches claimed the same range), don't renumber shipped IDs; add a disambiguating subsection note under the affected group and continue from a fresh range.

## Merged ≠ Done in Linear

Never trust ticket status alone for "what shipped." Verify in git:

- `git log --oneline main | grep -oE 'CHUCK-[0-9]+'` — tickets with merged commits shipped, whatever Linear says.
- `git branch --merged main` / `git merge-base --is-ancestor <sha> main` — settle "is this branch actually in?"

Merged PRs may sit in **In Review** (that's why `/epic-progress` counts Done + In Review as complete). If the workspace's GitHub integration auto-moves tickets to Done on merge, the cross-check simply confirms; keep doing it — status automation breaks silently.

## Grounding is the only door

Product knowledge enters via `/ground` (raw signal → extract → triaged change plan → executed doc updates) — never ad-hoc edits to `prd.md`/`requirements.md`. If you catch yourself editing a requirement without an extract behind it, stop and run the pipeline. Decisions (choices between alternatives with consequences) go through `/decide`.

Legacy note: pre-method artifacts in `plans/` and `docs/superpowers/specs/` are read-only history. When picking up a legacy spec, run its content through `/ground` into the feature docs first.

## Supersession

Only the **current** version of any DR lives in the tree (`docs/decisions/`); superseding a DR deletes the old file — git history is the archive. Every DR carries an inline Changelog. Commit message format: `docs: supersede DR-[topic]-v[N-1] with DR-[topic]-v[N] — [reason]`.

## Chuckbox-specific ground rules

- **Shared dev database:** all worktrees point at the one dev Supabase project. Destructive db scripts and migration pushes are sequenced, never parallel. Production pushes always require explicit user approval.
- **Real money in prod:** financial code changes ship only through the full validated loop (TDD, `make build`+`make test` green, AC verification as the implicated role).
- **Linear tool prefix:** the skills call Linear via `mcp__linear-chuckbox__*` — the project-scoped MCP server in `.mcp.json` (`linear-chuckbox` → https://mcp.linear.app/mcp), OAuth'd to the **blaahd-projects** workspace. The claude.ai Linear connector (with-caldera workspace) coexists under `mcp__claude_ai_Linear__*` and is NOT used by these skills. If the server name or connection type changes, update the `allowed-tools` frontmatter in `implement`, `qa`, `presentation`, and `epic-progress`.
