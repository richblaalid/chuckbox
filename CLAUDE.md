# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chuckbox is a management application for Scout units (troops, packs, crews). It handles:
- **Finances**: Scout accounts, billing, payments, and financial reporting with double-entry accounting
- **Advancement**: Rank and merit badge tracking with bulk sign-off capabilities
- **Roster**: Scout and adult member management with guardian associations

## Commands

```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint (flat config, ESLint 9)
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:ui      # Vitest UI
vitest run tests/unit/utils.test.ts  # Run single test file
```

### Dev Server Restart (Port-Specific)

**IMPORTANT:** This project runs on port 3000. To restart the dev server without affecting other projects:

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Never use `pkill -f "next dev"` as it kills ALL Next.js dev servers on the machine.

### Database Dev Tools

```bash
npm run db:reset       # Clear all data from database
npm run db:seed:base   # Seed unit with admin user ready to login
npm run db:seed:test   # Add test scouts, parents, and users for each role
npm run db:seed:all    # Run base + test seeds
npm run db:fresh       # Reset + seed all (fresh start)
npm run db:dump        # Export current database to JSON (supabase/seeds/)
npm run db:dump -- name  # Export with custom name
npm run db:restore -- supabase/seeds/file.json  # Restore from dump
npm run db:list        # List available dump files
```

**Test User Credentials** (password: `testpassword123`):
| Role | Email |
|------|-------|
| admin | richard.blaalid+admin@withcaldera.com |
| treasurer | richard.blaalid+treasurer@withcaldera.com |
| leader | richard.blaalid+leader@withcaldera.com |
| parent | richard.blaalid+parent@withcaldera.com |
| scout | richard.blaalid+scout@withcaldera.com |

**Workflow example:**
```bash
npm run db:dump -- before-testing  # Save current state
# ... do destructive testing ...
npm run db:restore -- supabase/seeds/before-testing.json  # Restore
```

### BSA Reference Data Seeding

The application seeds BSA official reference data (ranks, merit badges, leadership positions) from canonical data files. This data is critical for advancement tracking.

**Canonical data files** (source of truth in `data/`):
| File | Purpose |
|------|---------|
| `bsa-data-canonical.json` | Unified BSA data: merit badges, requirements, ranks (primary source) |
| `leadership-positions-2025.json` | Leadership positions (18 positions) |

**Rules for modifying seeders** (`scripts/bsa-reference-data.ts`, `scripts/db.ts`):
- NEVER reduce data quality when modifying seeders (e.g., removing fields like `image_url`, `category`)
- Always test with `npm run db:fresh` after any seeder changes
- The seed process validates expected counts - if validation fails, the seeder exits with error
- When adding new badge/requirement fields, update both the canonical data file AND the seeder

**Expected counts after seeding:**
- 141 merit badges (with images and categories)
- 7 ranks with 144+ requirements
- 11,000+ merit badge requirements (across all versions)
- 18 leadership positions

**Seed validation**: The seeder automatically validates data integrity. If critical fields are missing or counts are too low, the seed process will fail with an error message.

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Styling**: Tailwind CSS 4, shadcn/ui components (Radix primitives)
- **Forms**: react-hook-form + zod validation
- **Testing**: Vitest 4 + React Testing Library

### Route Structure
Routes use Next.js App Router with route groups:
- `src/app/(auth)/` - Public auth pages (login, logout, callback)
- `src/app/(dashboard)/` - Protected pages requiring authentication

The `(dashboard)/layout.tsx` handles auth validation and redirects unauthenticated users to `/login`.

### Supabase Integration
Two client patterns exist:
- `src/lib/supabase/server.ts` - Server Components (uses `cookies()`)
- `src/lib/supabase/client.ts` - Client Components (browser client)

Always use the appropriate client based on component type. The middleware (`src/middleware.ts`) handles session refresh.

### Database Types
`src/types/database.ts` contains auto-generated Supabase types. Key tables:
- `units` - Scout units (troops, packs)
- `profiles` - User profiles linked to Supabase Auth
- `unit_memberships` - Links users to units with roles
- `scouts` - Scout members within units
- `scout_accounts` - Financial accounts per scout (dual-balance: `billing_balance` for charges owed, `funds_balance` for scout savings)
- `journal_entries` / `journal_lines` - Double-entry accounting
- `billing_records` / `billing_charges` - Fair share billing
- `payments` - Payment records

### Supabase Environments

**CRITICAL: This project has separate dev and prod databases. Always verify the target before running migrations.**

| Environment | Project Ref | Purpose |
|-------------|-------------|---------|
| **Development** | `feownmcpkfugkcivdoal` | Local development, testing |
| **Production** | `jtzidlmxrorbjnygfvvp` | Live production data - DO NOT modify without explicit approval |

### Supabase Migration Safety Rules

**BEFORE running any `supabase db push` or migration command:**

1. **Always check which project is currently linked:**
   ```bash
   supabase projects list
   ```

2. **Link to the correct project (DEV by default):**
   ```bash
   supabase link --project-ref feownmcpkfugkcivdoal  # DEV
   ```

3. **Never push to production without explicit user approval.** If the user asks for a migration, assume DEV unless they specifically say "production" or "prod".

4. **After pushing migrations, remind user to reload schema cache** in Supabase Dashboard → Settings → API → "Reload schema cache"

### Supabase Migrations
Migrations are in `supabase/migrations/`.

**For development (default):**
```bash
supabase link --project-ref feownmcpkfugkcivdoal  # Ensure linked to DEV
supabase db push                                   # Push to DEV
```

**For production (requires explicit approval):**
```bash
supabase link --project-ref jtzidlmxrorbjnygfvvp  # Link to PROD
supabase db push                                   # Push to PROD
```

### Component Patterns
- UI primitives in `src/components/ui/` (shadcn/ui style)
- Feature components in `src/components/{feature}/`
- Use `cn()` from `src/lib/utils.ts` for class merging

---

## Available Skills & Plugins

This project uses Claude Code plugins to enforce consistent workflows. **Skills are mandatory at specific workflow stages.**

### Project Commands (`.claude/commands/`)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/plan [feature]` | Spec-driven feature planning | Starting any new feature |
| `/bugfix [bug]` | Systematic bug investigation | Starting any bug fix |
| `/execute [mode]` | Controlled task execution | Implementing approved plans |

### Project Skills (`.claude/skills/`)

| Skill | Purpose | Trigger |
|-------|---------|---------|
| `frontend-design` | High-quality UI development | **MANDATORY** for any UI work |
| `mermaid-diagrams` | Generate architecture diagrams | When visualizations help |
| `fix-mb-requirements` | Fix BSA data structure issues | BSA canonical data fixes |
| `vercel-react-best-practices` | React/Next.js performance guide | Reference during implementation |

### Superpowers Plugin (Workflow Enforcement)

| Skill | Purpose | When Required |
|-------|---------|---------------|
| `superpowers:brainstorming` | Socratic design refinement | **MANDATORY** before any new feature |
| `superpowers:test-driven-development` | RED-GREEN-REFACTOR cycle | **MANDATORY** for all implementation |
| `superpowers:systematic-debugging` | 4-phase root cause analysis | **MANDATORY** for any debugging |
| `superpowers:verification-before-completion` | Evidence before claims | **MANDATORY** before claiming done |
| `superpowers:writing-plans` | Detailed implementation plans | After design approval |
| `superpowers:requesting-code-review` | Pre-review checklist | Before requesting review |
| `superpowers:finishing-a-development-branch` | Merge/PR decision workflow | When feature complete |

### Code Quality Plugins

| Plugin | Purpose | When Required |
|--------|---------|---------------|
| `code-simplifier:code-simplifier` | Simplify recently modified code | **After each task**, before verification |
| `feature-dev:code-reviewer` | Deep code review against plan | After implementation complete |
| `feature-dev:code-architect` | Architecture design decisions | During planning phase |

### MCP Servers

| Server | Purpose | When to Use |
|--------|---------|-------------|
| `context7` | Up-to-date library documentation | **Before** using any library API |
| `playwright` | Browser automation testing | E2E testing, UI verification |

### Hooks (Auto-Triggered)

| Hook | Trigger | Purpose |
|------|---------|---------|
| `post-edit-lint.sh` | After Edit/Write on `.ts/.tsx` | Auto-runs ESLint on modified files |

---

## Core Philosophy

### Verification Before Completion

**No completion claims without fresh verification evidence.**

This is non-negotiable. Before claiming ANY task is complete:

1. **RUN** the verification command (`npm run build && npm test`)
2. **READ** the full output, check exit codes
3. **CONFIRM** output matches the claim
4. **ONLY THEN** claim completion

| Claim | Requires | NOT Sufficient |
|-------|----------|----------------|
| "Tests pass" | Test output: 0 failures | "Should pass", previous run |
| "Build succeeds" | Build output: exit 0 | "Linter passed" |
| "Bug fixed" | Regression test passes | "Code changed" |
| "Task complete" | Build + tests + requirements | Tests passing alone |

**Red Flags - STOP:**
- Using "should", "probably", "seems to"
- Expressing satisfaction before verification
- About to commit without running tests
- Relying on partial verification

### Test-Driven Development

**No production code without a failing test first.**

The TDD cycle is mandatory for all implementation:

```
RED → Verify fails → GREEN → Verify passes → REFACTOR → Verify still green
```

- Write test first, watch it fail
- Write minimal code to pass
- Refactor only after green
- **If you wrote code before the test, delete it and start over**

### Simplification After Implementation

After completing each task, **before verification**:

1. Run `code-simplifier:code-simplifier` on modified files
2. Review simplifications for correctness
3. Then proceed to verification

This ensures code meets project standards before review.

---

## Development Workflow

### Spec-Driven Development

**For new features**, use `/plan [feature description]`:
1. Gather requirements by asking clarifying questions
2. Explore codebase for existing patterns
3. Create plan document in `/plans/`
4. Get user approval before implementing
5. Implement with TodoWrite tracking

**For bug fixes**, use `/bugfix [bug description]`:
1. Understand and reproduce the bug
2. Investigate root cause (not just symptoms)
3. Document in `/plans/bugfix-[name].md`
4. Confirm approach before implementing
5. Write test, fix, verify

### Quality Gates

**Phase 1: Before Implementation**
- [ ] Used `superpowers:brainstorming` to refine requirements (MANDATORY for new features)
- [ ] Researched library docs with `context7` MCP
- [ ] Explored codebase for patterns (use Task with Explore agent)
- [ ] Plan document created and approved in `/plans/`

**Phase 2: During Implementation**
- [ ] Use TodoWrite to track progress
- [ ] Use `superpowers:test-driven-development` - write test first, watch fail, then implement
- [ ] Use `frontend-design` skill for all UI work
- [ ] Use `context7` MCP for library documentation
- [ ] Run `npm run build` after significant changes
- [ ] Run `npm test` for affected areas

**Phase 3: After Each Task**
- [ ] Run `code-simplifier:code-simplifier` on modified files
- [ ] Run `npm run build` - must pass
- [ ] Run `npm test` - must pass
- [ ] Only claim completion AFTER seeing passing output

**Phase 4: Before Commit/PR**
- [ ] Used `superpowers:verification-before-completion`
- [ ] All tests passing (fresh run, not cached)
- [ ] Build succeeds (fresh run)
- [ ] Used `superpowers:requesting-code-review` or `feature-dev:code-reviewer`

### Plan Documents

Plans live in `/plans/` directory:
- `PLAN-TEMPLATE.md` - Template for new features
- `BUG-TEMPLATE.md` - Template for bug fixes
- Feature plans follow the template structure

### When to Use Plan Mode

Use Claude's built-in Plan Mode (`EnterPlanMode`) for:
- Multi-file changes
- Architectural decisions
- Features with multiple valid approaches
- Any change you're uncertain about

Skip planning for:
- Single-line fixes
- Obvious bugs with clear solutions
- Tasks with explicit, detailed instructions

### Important Notes
- Supabase queries return single objects (not arrays) for one-to-one relations like `scout_accounts`
- Protected routes check `unit_memberships` for role-based access (admin, treasurer, leader, parent, scout)
- User management (invite, roles, remove) is in **Settings > Users tab** (admin only)
- The middleware deprecation warning about "proxy" is expected - Next.js 16 is transitioning middleware conventions
- Scout accounts use a dual-balance model:
  - `billing_balance`: Charges owed to unit (negative = owes money)
  - `funds_balance`: Scout savings from fundraising/overpayments (always >= 0)
- Avoid reading localStorage in initial state - defer to useEffect to prevent hydration mismatches
- Nested interactive elements (button inside button) cause React hydration issues - use `<div role="button">` with keyboard handlers instead

---

## Session Protocol

### Starting a Session

1. Read this file (CLAUDE.md)
2. Read the relevant plan file in `/plans/` to find the next task
3. State which task you'll work on (use task number if available)
4. State your implementation approach briefly
5. Wait for approval before writing code

### During Implementation

1. Work on **ONE task at a time**
2. Use Context7 for library documentation before implementing
3. Run `npm run build` and `npm test` after changes
4. If tests fail, **STOP** and fix before continuing
5. Mark task complete **immediately** after finishing
6. Update Task Log with date and commit hash

### Completing a Task

1. **Simplify**: Run `code-simplifier:code-simplifier` on modified files
2. **Verify**: Run `npm run build && npm test` - MUST see passing output
3. **Confirm**: Only after seeing "0 failures" claim task complete
4. Mark task complete in plan/tasks file
5. Update Task Log with date and commit
6. Commit with descriptive message
7. Report what you completed with verification evidence

### Between Sessions

If continuing work from a previous session:
1. Read the plan file to see progress
2. Check the Task Log for what was last completed
3. Identify the next pending task
4. Resume from step 3 of "Starting a Session"

---

## Do NOT

**These rules are critical. Violating them wastes time and creates bugs.**

### Process Violations
- ❌ Modify multiple tasks without approval
- ❌ Skip tests or type checking
- ❌ Proceed after test/build failures without fixing
- ❌ Make architectural changes without discussion
- ❌ Install new dependencies without discussing first
- ❌ Push to production database without explicit approval
- ❌ Commit code that doesn't build or pass tests

### Code Quality Violations
- ❌ Use `any` types in TypeScript
- ❌ Write code that doesn't match existing patterns
- ❌ Create new files when editing existing ones would work
- ❌ Add features beyond what was requested
- ❌ Use nested ternary operators (prefer if/else or switch)
- ❌ Write overly clever code that sacrifices readability

### Verification Violations (from superpowers philosophy)
- ❌ Claim "tests pass" without running them in this message
- ❌ Say "should work", "probably fixed", "seems correct"
- ❌ Express satisfaction before verification ("Great!", "Done!")
- ❌ Write production code before writing a failing test
- ❌ Keep code written before tests as "reference" (delete and rewrite)
- ❌ Trust previous test runs - always run fresh
- ❌ Skip the simplification step before verification

---

## Custom Commands

### `/plan [feature description]`

Start spec-driven development for a new feature using `superpowers:brainstorming`.

```
/plan Add CSV export for scout data
/plan refresh                        # Re-read and update existing plan
```

**Workflow:**
1. Use `superpowers:brainstorming` - one question at a time, refine requirements
2. Research library docs (Context7)
3. Explore codebase (Explore agent)
4. Use `feature-dev:code-architect` for architecture decisions
5. Create plan in `/plans/[feature-name].md` using `superpowers:writing-plans`
6. Get approval before implementing

### `/bugfix [bug description]`

Investigate and fix a bug systematically using `superpowers:systematic-debugging`.

```
/bugfix Login redirect fails after session timeout
/bugfix Payment amounts showing negative
```

**Workflow:**
1. Use `superpowers:systematic-debugging` (4-phase root cause analysis)
2. Ask clarifying questions to reproduce
3. Investigate root cause (not symptoms)
4. Document in `/plans/bugfix-[name].md`
5. Confirm approach before implementing
6. Write failing test that reproduces bug (TDD RED)
7. Fix bug, verify test passes (TDD GREEN)
8. Run `code-simplifier:code-simplifier`
9. Verify with `npm run build && npm test`

### `/execute [mode]`

Execute tasks from an approved plan with safeguards.

```
/execute           # Execute next single pending task
/execute phase     # Execute all tasks in current phase (max 5)
/execute to 1.2.3  # Execute up to and including task 1.2.3
/execute 1.2.3     # Execute only task 1.2.3
```

**Per-Task Workflow:**
1. Announce task number and description
2. Use `context7` if task involves library APIs
3. Use `superpowers:test-driven-development` - write test first
4. Implement minimal code to pass test
5. Run `code-simplifier:code-simplifier` on modified files
6. Run `npm run build && npm test` - MUST pass
7. Mark task complete, commit

**Safeguards:**
- Stops immediately on test/build failures
- Maximum 5 tasks per `/execute phase`
- Requires approval at phase checkpoints
- Auto-commits after each successful task
- **No completion claims without fresh verification output**

### Task Numbering

Tasks use format: `{Phase}.{Section}.{Task}`

- **Phase 0**: Foundation (migrations, types, setup)
- **Phase 1+**: Feature phases
- Example: `1.2.3` = Phase 1, Section 2, Task 3

See `plans/PLAN-TEMPLATE.md` and `plans/TASKS-TEMPLATE.md` for formats
