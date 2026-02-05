# Audit Remediation Plan (v2)

> **Status:** In Review
> **Created:** 2026-02-04
> **Updated:** 2026-02-04
> **Source:** [Code Audit Report](./code-audit.md)
> **Estimated Effort:** 30-40 hours (1-2 weeks focused)

---

## 1. Requirements

### 1.1 Problem Statement

The code audit identified several areas requiring remediation:
- **High**: N+1 query patterns causing performance issues in bulk operations
- **High**: 327 console.log statements need cleanup
- **Medium**: Two files exceed 2000 lines (advancement.ts: 3,523, troop-advancement-import.ts: 2,039)
- **Medium**: Test coverage at ~45%, with critical actions under 15%
- **Low**: 5 `as any` type casts, 2 ESLint warnings

### 1.2 User Stories

- [x] As a **developer**, I want clean linting so that CI passes without warnings
- [x] As a **developer**, I want smaller modules so that code is easier to navigate and test
- [x] As a **leader**, I want bulk sign-offs to complete quickly so that I can process 30+ scouts efficiently
- [x] As a **developer**, I want comprehensive tests so that refactors don't introduce regressions

### 1.3 Acceptance Criteria

- [ ] ESLint passes with zero errors
- [ ] Zero `as any` type casts in src/
- [ ] Zero `console.log` statements in src/ (console.error in catch blocks acceptable)
- [ ] `advancement.ts` split into 5+ focused modules (<500 lines each)
- [ ] Bulk operations use <20 queries for 30 scouts (currently 180+)
- [ ] Test coverage >55% overall, >60% for advancement modules
- [ ] All existing tests pass after each phase
- [ ] Zero imports from old `advancement.ts` location after Phase 1

### 1.4 Out of Scope (Deferred)

| Item | Reason | Track |
|------|--------|-------|
| Split `troop-advancement-import.ts` | Lower usage frequency, less critical | Future sprint |
| Structured logging (Sentry/similar) | Requires infrastructure decision | Tech debt ticket |
| Payment flow integration tests | Requires test fixtures setup | Future sprint |

### 1.5 Decisions Made

| Question | Answer | Decided |
|----------|--------|---------|
| Phase 1 refactor approach? | 4 incremental PRs | 2026-02-04 |
| Replace console.log with logger? | No, just remove. Add logging later | 2026-02-04 |
| Timeline? | 1-2 weeks focused (~30-40h) | 2026-02-04 |

---

## 2. Technical Design

### 2.1 Approach

**Phase 1 Strategy: Incremental Module Extraction**

Rather than one massive refactor, we extract modules incrementally:
1. Create module structure with index.ts re-exporting from original file
2. Extract one category at a time, updating index.ts exports
3. Each PR leaves the app in a working state
4. Original file shrinks progressively until deleted

This approach:
- Reduces risk (each PR is reviewable and revertible)
- Maintains working state throughout
- Allows parallel work if needed

### 2.2 Module Structure

```
src/app/actions/advancement/
├── index.ts           # Re-exports all (maintains import compatibility)
├── types.ts           # Shared types and interfaces
├── utils.ts           # Helper functions (auth, validation)
├── rank-progress.ts   # Individual rank operations
├── merit-badges.ts    # Individual merit badge operations
├── bulk-operations.ts # Bulk sign-off and approval functions
└── queries.ts         # Read-only data fetching functions
```

### 2.3 Import Blast Radius

**22 files** import from `@/app/actions/advancement`:
- 2 page components
- 19 advancement components
- 1 test file

All use the `@/app/actions/advancement` alias (no relative imports), so the index.ts re-export pattern will maintain compatibility.

### 2.4 N+1 Query Fix Strategy

Current pattern (bulkSignOffForScouts):
```typescript
for (const scoutId of params.scoutIds) {
  // 6+ queries per scout = 180 queries for 30 scouts
}
```

Target pattern:
```typescript
// 1. Batch fetch all existing progress
const existingProgress = await supabase
  .from('scout_rank_progress')
  .select('*')
  .in('scout_id', params.scoutIds)

// 2. Identify missing records
const needsInsert = scoutIds.filter(id => !existingProgress.has(id))

// 3. Batch insert
await supabase.from('scout_rank_progress').insert(needsInsert.map(...))

// 4. Batch update
await supabase.from('scout_rank_requirement_progress').upsert(...)
```

---

## 3. Implementation Tasks

**Task Numbering:** `{Phase}.{Section}.{Task}` (e.g., 0.1.1, 1.2.3)

---

### Phase 0: Foundation & Hygiene

#### 0.1 ESLint & Type Safety

- [x] **0.1.1** Fix ESLint setState warning in `multi-select-action-bar.tsx`
  - File: `src/components/advancement/multi-select-action-bar.tsx:41`
  - Fix: Add eslint-disable comment or refactor to useSyncExternalStore
  - Test: `npm run lint` passes

- [x] **0.1.2** Fix ESLint setState warning in `adult-form.tsx`
  - File: `src/components/roster/adult-form.tsx:109`
  - Fix: Add eslint-disable comment (intentional hydration safety pattern)
  - Test: `npm run lint` passes

- [x] **0.1.3** Add Supabase RPC type definitions
  - File: `src/types/database.ts`
  - Note: Types already existed in generated database.ts
  - Test: TypeScript compiles without errors

- [x] **0.1.4** Remove `as any` casts from billing components
  - Files: `edit-billing-dialog.tsx:54`, `billing-form.tsx:112`, `void-billing-dialog.tsx:58`
  - Fix: Use typed RPC wrapper or generated types from 0.1.3
  - Test: `npm run build` passes

- [x] **0.1.5** Remove `as any` cast from `extension-auth.ts`
  - File: `src/lib/auth/extension-auth.ts:44`
  - Fix: Add proper type for `extension_auth_tokens` table
  - Test: `npm run build` passes

- [ ] **0.1.6** Remove `as any` cast from `onboarding.ts`
  - File: `src/app/actions/onboarding.ts:18`
  - Fix: Create typed helper for dynamic table access
  - Test: `npm run build` passes

**Checkpoint 0.1**: `npm run lint` passes, `npm run build` passes

#### 0.2 Console.log Cleanup

- [ ] **0.2.1** Remove console.log from `src/app/actions/`
  - Keep: console.error in catch blocks for error reporting
  - Remove: All debug console.log statements
  - Test: `grep -r "console.log" src/app/actions/` returns empty

- [ ] **0.2.2** Remove console.log from `src/app/api/scoutbook/`
  - Test: `grep -r "console.log" src/app/api/scoutbook/` returns empty

- [ ] **0.2.3** Remove console.log from `src/app/api/square/`
  - Test: `grep -r "console.log" src/app/api/square/` returns empty

- [ ] **0.2.4** Remove console.log from remaining `src/app/api/` routes
  - Test: `grep -r "console.log" src/app/api/` returns empty

- [ ] **0.2.5** Remove console.log from `src/components/`
  - Test: `grep -r "console.log" src/components/` returns empty

- [ ] **0.2.6** Remove console.log from `src/lib/`
  - Test: `grep -r "console.log" src/lib/` returns empty

**Checkpoint 0.2**: Zero console.log in src/, build passes, tests pass

#### 0.3 Pre-Refactor Analysis

- [ ] **0.3.1** Document all advancement.ts export sites
  - Run: `grep -r "from.*advancement" src/`
  - Output: List in this plan for tracking
  - Already documented: 22 files (see Section 2.3)

- [ ] **0.3.2** Profile baseline query counts for bulk operations
  - Enable Supabase query logging or add counter
  - Run: Bulk sign-off for 10 scouts
  - Document: Current query count as baseline (expected: 60+)
  - Test: Baseline documented for comparison in Phase 2

- [ ] **0.3.3** Verify all existing advancement tests pass
  - Run: `npm test -- tests/unit/actions/advancement.test.ts`
  - Ensure: Clean baseline before refactor
  - Test: All tests pass

**Phase 0 Complete**: ESLint clean, no any types, no console.log, baseline documented

---

### Phase 1: Architecture - Split advancement.ts

> **Strategy**: 4 incremental PRs, each leaving the app in working state

#### 1.1 Create Module Structure (PR #1 prep)

- [ ] **1.1.1** Create `src/app/actions/advancement/` directory structure
  - Create: `advancement/index.ts` that re-exports from `../advancement.ts`
  - Test: All existing imports still work (no changes needed in consumers)

- [ ] **1.1.2** Create `advancement/types.ts` with shared types
  - Extract: `ActionResult`, progress types, parameter interfaces
  - Test: Types compile, index.ts exports them

- [ ] **1.1.3** Create `advancement/utils.ts` with helpers
  - Extract: Auth helpers, validation functions, common patterns
  - Test: Utils compile, index.ts exports them

#### 1.2 Extract Rank Progress Functions (PR #1)

- [ ] **1.2.1** Create `advancement/rank-progress.ts`
  - Move: `initializeRankProgress` function
  - Update: index.ts to re-export from new location
  - Test: Build passes, tests pass

- [ ] **1.2.2** Move `markRequirementComplete` and related
  - Move: `markRequirementComplete`, `markRequirementCompleteWithInit`
  - Test: Build passes

- [ ] **1.2.3** Move `undoRequirementCompletion`
  - Test: Build passes

- [ ] **1.2.4** Move `updateRequirementNotes` and `addRankRequirementNoteWithInit`
  - Test: Build passes

- [ ] **1.2.5** Clean up original file - remove moved rank functions
  - Verify: No duplicate exports
  - Test: Build passes, all tests pass

**PR #1 Checkpoint**: Rank functions extracted, ~700 lines moved, app works

#### 1.3 Extract Merit Badge Functions (PR #2)

- [ ] **1.3.1** Create `advancement/merit-badges.ts`
  - Move: `startMeritBadge`, `getMeritBadgeVersions`
  - Update: index.ts exports
  - Test: Build passes

- [ ] **1.3.2** Move merit badge progress functions
  - Move: `markMeritBadgeRequirement`, `undoMeritBadgeRequirementCompletion`
  - Test: Build passes

- [ ] **1.3.3** Move `updateMeritBadgeRequirementNotes` and related
  - Move: `addMeritBadgeRequirementNoteWithInit`, `switchMeritBadgeVersion`
  - Test: Build passes

- [ ] **1.3.4** Clean up original file - remove moved MB functions
  - Test: Build passes, all tests pass

**PR #2 Checkpoint**: Merit badge functions extracted, ~800 lines moved

#### 1.4 Extract Bulk Operations (PR #3)

- [ ] **1.4.1** Create `advancement/bulk-operations.ts`
  - Move: `bulkMarkRequirementsComplete`
  - Test: Build passes

- [ ] **1.4.2** Move `bulkApproveRequirements` functions
  - Move: `bulkApproveRequirements`, `bulkApproveRequirementsWithInit`
  - Test: Build passes

- [ ] **1.4.3** Move `bulkApproveMeritBadgeRequirements` functions
  - Move: Both versions (with and without init)
  - Test: Build passes

- [ ] **1.4.4** Move `bulkSignOffForScouts` and `bulkRecordProgress`
  - These are the main N+1 targets for Phase 2
  - Test: Build passes

- [ ] **1.4.5** Move remaining bulk functions
  - Move: `bulkApproveParentSubmissions`, `bulkAwardMeritBadges`, `assignRequirementToScouts`, etc.
  - Test: Build passes, all tests pass

**PR #3 Checkpoint**: Bulk operations extracted, ~1200 lines moved

#### 1.5 Extract Query Functions (PR #4)

- [ ] **1.5.1** Create `advancement/queries.ts`
  - Move: `getRankRequirementsForUnit`, `getRankBrowserData`
  - Test: Build passes

- [ ] **1.5.2** Move merit badge query functions
  - Move: `getMeritBadgeBrowserData`, `getMeritBadgeCategories`, `getMeritBadgeRequirements`
  - Test: Build passes

- [ ] **1.5.3** Move summary and progress functions
  - Move: `getUnitAdvancementSummary`, `getScoutAdvancementProgress`, `getCurrentUserInfo`
  - Test: Build passes

- [ ] **1.5.4** Move remaining query functions
  - Move: `getBsaMeritBadges`, `getMeritBadgeRequirementsForVersion`
  - Test: Build passes

#### 1.6 Finalize & Delete Original (PR #4 continued)

- [ ] **1.6.1** Verify original advancement.ts is empty or near-empty
  - Check: Only imports/re-exports should remain, if anything
  - Test: `wc -l src/app/actions/advancement.ts` < 50

- [ ] **1.6.2** Update index.ts to import from modules only
  - Remove: Re-exports from `../advancement.ts`
  - Test: All 22 consumer files still work

- [ ] **1.6.3** Delete original `advancement.ts`
  - Verify: `grep -r "actions/advancement'" src/` returns only advancement/ imports
  - Test: Build passes

- [ ] **1.6.4** Run full test suite
  - Test: `npm test` all pass
  - Test: `npm run build` passes

**Phase 1 Complete**: advancement.ts split into 5 modules, all imports work

---

### Phase 2: Performance - Fix N+1 Queries

#### 2.1 Batch Rank Sign-Off

- [ ] **2.1.1** Refactor `bulkSignOffForScouts` to batch fetch
  - Replace: Loop queries with single `in()` query for existing progress
  - Test: Function still works for 1 scout

- [ ] **2.1.2** Implement batch insert for missing rank progress
  - Replace: Individual inserts with bulk insert
  - Test: New scouts get progress records created

- [ ] **2.1.3** Implement batch insert for missing requirement progress
  - Replace: Individual requirement inserts with bulk insert
  - Test: Requirements initialized correctly

- [ ] **2.1.4** Implement batch update for requirement completion
  - Replace: Individual updates with upsert
  - Test: Requirements marked complete correctly

- [ ] **2.1.5** Verify query count reduction
  - Run: Same baseline test from 0.3.2 (10 scouts)
  - Assert: <20 total queries (down from 60+)
  - Test: Performance test passes

#### 2.2 Batch Merit Badge Operations

- [ ] **2.2.1** Refactor `bulkApproveMeritBadgeRequirements`
  - Apply: Same batching pattern as rank operations
  - Test: Function works for 1 scout, multiple scouts

- [ ] **2.2.2** Refactor `bulkApproveMeritBadgeRequirementsWithInit`
  - Handle: Both existing and new progress records
  - Test: Mixed state scouts handled correctly

- [ ] **2.2.3** Verify merit badge query count reduction
  - Test: <15 queries for 10-scout bulk approval

#### 2.3 Batch Activity Recording

- [ ] **2.3.1** Refactor `bulkRecordProgress`
  - Note: `bulkSignOffForScouts` delegates to this
  - Apply: Batching for all record types
  - Test: All progress types work

- [ ] **2.3.2** Add integration test for bulk performance
  - Test: 30-scout bulk sign-off completes in <2s
  - Test: Query count stays under 30

**Phase 2 Complete**: Bulk operations 10x faster, <30 queries for 30 scouts

---

### Phase 3: Testing - Improve Coverage

#### 3.1 Rank Progress Tests

- [ ] **3.1.1** Add tests for `initializeRankProgress`
  - Test: Creates progress record
  - Test: Initializes all requirements
  - Test: Handles already-exists case

- [ ] **3.1.2** Add tests for `markRequirementComplete` happy path
  - Test: Marks single requirement complete
  - Test: Records signed_off_by and signed_off_at

- [ ] **3.1.3** Add tests for `markRequirementComplete` edge cases
  - Test: Already complete requirement
  - Test: Invalid requirement ID
  - Test: Unauthorized user

- [ ] **3.1.4** Add tests for `undoRequirementCompletion`
  - Test: Clears completion data
  - Test: Handles not-complete requirement

#### 3.2 Bulk Operation Tests

- [ ] **3.2.1** Add tests for `bulkMarkRequirementsComplete`
  - Test: Multiple requirements, single scout
  - Test: Mixed already-complete states

- [ ] **3.2.2** Add tests for `bulkSignOffForScouts` single scout
  - Test: Single scout, single requirement
  - Test: Verifies progress created

- [ ] **3.2.3** Add tests for `bulkSignOffForScouts` multiple scouts
  - Test: 5 scouts, verifies all updated
  - Test: Mixed existing/new progress states

- [ ] **3.2.4** Add tests for error handling
  - Test: Partial failure handling
  - Test: Auth failure

#### 3.3 Merit Badge Tests

- [ ] **3.3.1** Add tests for `startMeritBadge`
  - Test: Creates progress record with correct version
  - Test: Handles already-started badge

- [ ] **3.3.2** Add tests for `bulkApproveMeritBadgeRequirements`
  - Test: Multiple requirements approved
  - Test: Mixed states handled

- [ ] **3.3.3** Add tests for version handling
  - Test: `switchMeritBadgeVersion` preserves progress
  - Test: Version-specific requirements

#### 3.4 Query Function Tests

- [ ] **3.4.1** Add tests for `getRankRequirementsForUnit`
  - Test: Returns correct structure
  - Test: Filters by unit

- [ ] **3.4.2** Add tests for `getUnitAdvancementSummary`
  - Test: Aggregates correctly
  - Test: Handles empty unit

**Phase 3 Complete**: Coverage >55% overall, >60% for advancement modules

---

## 4. Files to Create/Modify

### New Files

| File | Purpose | Phase |
|------|---------|-------|
| `src/app/actions/advancement/index.ts` | Re-exports all functions | 1.1.1 |
| `src/app/actions/advancement/types.ts` | Shared TypeScript types | 1.1.2 |
| `src/app/actions/advancement/utils.ts` | Helper functions | 1.1.3 |
| `src/app/actions/advancement/rank-progress.ts` | Rank progress functions | 1.2 |
| `src/app/actions/advancement/merit-badges.ts` | Merit badge functions | 1.3 |
| `src/app/actions/advancement/bulk-operations.ts` | Bulk sign-off functions | 1.4 |
| `src/app/actions/advancement/queries.ts` | Read-only query functions | 1.5 |
| `tests/unit/actions/advancement/rank-progress.test.ts` | Rank progress tests | 3.1 |
| `tests/unit/actions/advancement/bulk-operations.test.ts` | Bulk operation tests | 3.2 |

### Modified Files

| File | Changes | Phase |
|------|---------|-------|
| `src/types/database.ts` | Add RPC function types | 0.1.3 |
| `src/components/billing/edit-billing-dialog.tsx` | Remove `as any` | 0.1.4 |
| `src/components/billing/billing-form.tsx` | Remove `as any` | 0.1.4 |
| `src/components/billing/void-billing-dialog.tsx` | Remove `as any` | 0.1.4 |
| `src/lib/auth/extension-auth.ts` | Remove `as any` | 0.1.5 |
| `src/app/actions/onboarding.ts` | Remove `as any` | 0.1.6 |
| `src/components/advancement/multi-select-action-bar.tsx` | Fix ESLint | 0.1.1 |
| `src/components/roster/adult-form.tsx` | Fix ESLint | 0.1.2 |
| Multiple src/ files | Remove console.log | 0.2 |

### Files to Delete

| File | Reason | Phase |
|------|--------|-------|
| `src/app/actions/advancement.ts` | Replaced by module directory | 1.6.3 |

---

## 5. Testing Strategy

### After Each Task

```bash
npm run build    # Must pass
npm run lint     # Must pass (after Phase 0)
```

### After Each PR (Phase 1)

```bash
npm test                                    # All tests pass
grep -r "actions/advancement'" src/        # Verify no broken imports
```

### Performance Verification (Phase 2)

1. Enable Supabase query logging in dev
2. Run bulk sign-off for 10 scouts
3. Count queries in logs
4. Assert: <20 total (baseline was 60+)

### Coverage Targets (Phase 3)

| Module | Current | Target |
|--------|---------|--------|
| `advancement/*.ts` | 14.68% | >60% |
| `onboarding.ts` | 6.55% | (deferred) |
| Overall | ~45% | >55% |

### Rollback Plan

| Phase | Rollback Strategy |
|-------|-------------------|
| Phase 0 | Revert individual commits (independent tasks) |
| Phase 1 | Revert to previous PR (each PR is atomic) |
| Phase 2 | Keep old implementation behind flag until verified |
| Phase 3 | Tests are additive, no rollback needed |

---

## 6. Rollout Plan

### PR Sequence

1. **PR: Phase 0** - Hygiene (can merge immediately)
2. **PR: Phase 1.1-1.2** - Structure + Rank functions
3. **PR: Phase 1.3** - Merit badge functions
4. **PR: Phase 1.4** - Bulk operations
5. **PR: Phase 1.5-1.6** - Queries + cleanup
6. **PR: Phase 2** - Performance optimizations
7. **PR: Phase 3** - Test coverage (can be multiple PRs)

### Dependencies

- Phase 1 depends on Phase 0 complete
- Phase 2 depends on Phase 1 complete (operates on new modules)
- Phase 3 can run in parallel with Phase 2

### Verification

After each phase:
1. Deploy to dev environment
2. Run advancement bulk operations manually
3. Verify no regressions in functionality
4. Check Supabase dashboard for query counts (Phase 2)

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 | 15 | 5 | 🔄 In Progress |
| Phase 1 | 22 | 0 | ⬜ Not Started |
| Phase 2 | 11 | 0 | ⬜ Not Started |
| Phase 3 | 15 | 0 | ⬜ Not Started |
| **Total** | **63** | **5** | 🔄 In Progress |

---

## 8. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 0.1.1 | 2026-02-04 | pending | ESLint fix: multi-select-action-bar.tsx |
| 0.1.2 | 2026-02-04 | pending | ESLint fix: adult-form.tsx |
| 0.1.3 | 2026-02-04 | pending | RPC types already existed |
| 0.1.4 | 2026-02-04 | pending | Removed as any from billing components |
| 0.1.5 | 2026-02-04 | pending | Removed as any from extension-auth.ts |

---

## Approval

- [x] Requirements reviewed by: Rich (via peer review)
- [x] Technical design reviewed by: Claude (staff engineer)
- [x] Ready for implementation
