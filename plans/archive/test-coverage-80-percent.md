# Test Coverage 80% Target Implementation Plan

> **Status:** Draft
> **Created:** 2026-01-23
> **Author:** Claude

---

## 1. Requirements

### 1.1 Problem Statement

Current test coverage is incomplete - only 50% of action files, 7% of API routes, and 33% of lib files have tests. Critical code paths like `advancement.ts` (3,400+ lines, heavily modified) and `scoutbook-import.ts` have zero test coverage. This creates risk when making changes and makes it harder to catch regressions.

### 1.2 User Stories

- [x] As a **developer**, I want comprehensive test coverage so that I can refactor code with confidence
- [x] As a **maintainer**, I want critical paths tested so that regressions are caught before production

### 1.3 Acceptance Criteria

- [ ] Overall statement coverage ≥ 80%
- [ ] `advancement.ts` has tests for core sign-off functions
- [ ] `scoutbook-import.ts` has tests for import logic
- [ ] Integration tests exist for critical Supabase flows
- [ ] All existing tests continue to pass
- [ ] Coverage report shows no critical files below 70%

### 1.4 Out of Scope

- Component testing (160 components - lower risk, higher effort)
- E2E Playwright tests
- Visual regression testing
- Performance testing

### 1.5 Open Questions

| Question | Answer | Decided By |
|----------|--------|------------|
| Priority approach? | Critical paths first | User |
| Test types? | Unit + Integration | User |
| Include components? | No (not answered, assuming exclude) | Default |

---

## 2. Technical Design

### 2.1 Approach

**Strategy: Critical-first with integration tests**

1. **Phase 1**: Add unit tests for untested action files (highest risk)
2. **Phase 2**: Add integration tests for critical database flows
3. **Phase 3**: Fill gaps in lib files and API routes

**Why this approach?**
- Action files contain critical business logic (sign-offs, imports, payments)
- Integration tests catch real database/RLS issues that unit tests miss
- Following existing patterns minimizes learning curve

### 2.2 Test Infrastructure

**Existing infrastructure to leverage:**
- Vitest with jsdom environment
- Supabase mock utilities in `tests/mocks/supabase.ts`
- Fixtures in `tests/mocks/fixtures/index.ts`
- Square payment mocks in `tests/mocks/square.ts`

**New infrastructure needed:**
- Advancement-specific fixtures (scouts, ranks, badges, progress records)
- Integration test utilities for real Supabase connections
- Scoutbook import fixtures (CSV data, expected outputs)

### 2.3 Coverage Targets by File

| File | Current | Target | Priority |
|------|---------|--------|----------|
| `advancement.ts` | 0% | 80% | **High** |
| `scoutbook-import.ts` | 0% | 75% | **High** |
| `onboarding.ts` | 0% | 70% | Medium |
| `fundraiser-types.ts` | 0% | 70% | Low |
| `src/lib/notes-utils.ts` | 0% | 90% | Medium |
| `src/lib/feature-flags.ts` | 0% | 80% | Low |

### 2.4 Integration Test Strategy

Integration tests will use a **test Supabase instance** with:
- Dedicated test database (or isolated schema)
- Seeded test data
- Cleanup after each test suite
- Environment variable `TEST_SUPABASE_URL` and `TEST_SUPABASE_SERVICE_KEY`

---

## 3. Implementation Tasks

**Task Numbering:** `{Phase}.{Section}.{Task}` (e.g., 0.1.1, 1.2.3)

### Phase 0: Foundation

#### 0.1 Test Infrastructure
- [x] **0.1.1** Create advancement-specific fixtures
  - Files: `tests/mocks/fixtures/advancement.ts`
  - Content: Mock ranks, badges, progress records, requirements
  - Test: Fixtures importable and type-safe ✓

- [x] **0.1.2** Create scoutbook import fixtures
  - Files: `tests/mocks/fixtures/scoutbook.ts`
  - Content: Sample CSV data, expected parsed outputs
  - Test: Fixtures match real Scoutbook export format ✓

- [x] **0.1.3** Add advancement mock helpers to supabase.ts
  - Files: `tests/mocks/supabase.ts`
  - Content: Helpers for mocking advancement queries
  - Test: Helpers work in test context ✓

---

### Phase 1: Critical Action Tests

#### 1.1 Advancement Actions (Core Sign-Off)
- [x] **1.1.1** Test `markRequirementComplete` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Auth check, permission check, success, error handling
  - Test: `npm test -- advancement` ✓ (9 tests)

- [x] **1.1.2** Test `markMeritBadgeRequirement` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Auth, badge progress lookup, completion
  - Test: `npm test -- advancement` ✓ (6 tests)

- [x] **1.1.3** Test `undoRequirementCompletion` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Auth, status validation, undo logic
  - Test: `npm test -- advancement` ✓ (10 tests)

- [x] **1.1.4** Test `bulkSignOffRankRequirements` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Multiple requirements, partial failures, rollback
  - Test: `npm test -- advancement` ✓ (5 tests)

#### 1.2 Advancement Actions (Optimized Queries)
- [x] **1.2.1** Test `getUnitAdvancementSummary` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Empty unit, scouts with progress, stats calculation
  - Test: `npm test -- advancement` ✓ (3 tests)

- [x] **1.2.2** Test `getRankRequirementsForUnit` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Version filtering, rank data return
  - Test: `npm test -- advancement` ✓ (2 tests)

- [x] **1.2.3** Test `getMeritBadgeCategories` function
  - Files: `tests/unit/actions/advancement.test.ts`
  - Cases: Badge list, unique categories extraction
  - Test: `npm test -- advancement` ✓ (3 tests)

#### 1.3 Scoutbook Import Actions
- [x] **1.3.1** Test `importScoutbookHistory` function
  - Files: `tests/unit/actions/scoutbook-import.test.ts`
  - Cases: Auth, permission, empty selections, rank import
  - Test: `npm test -- scoutbook-import` ✓ (7 tests)

- [x] **1.3.2** Test auth and permission checks
  - Files: `tests/unit/actions/scoutbook-import.test.ts`
  - Cases: Not authenticated, profile not found, not a leader
  - Test: Included in 1.3.1 ✓

- [x] **1.3.3** Test existing progress handling
  - Files: `tests/unit/actions/scoutbook-import.test.ts`
  - Cases: New progress creation, existing progress update
  - Test: Included in 1.3.1 ✓

---

### Phase 2: Integration Tests

#### 2.1 Integration Test Setup
- [x] **2.1.1** Create integration test utilities
  - Files: `tests/integration/setup.ts`
  - Content: Real Supabase connection, cleanup utilities
  - Test: Can connect to test database ✓

- [x] **2.1.2** Create test data seeding script
  - Files: `tests/integration/seed.ts`
  - Content: Create test unit, scouts, ranks for integration tests
  - Test: Data exists after seeding ✓

#### 2.2 Advancement Integration Tests
- [x] **2.2.1** Test requirement sign-off flow end-to-end
  - Files: `tests/integration/advancement.test.ts`
  - Flow: Create progress → Sign off → Verify in DB
  - Test: `npm test -- integration/advancement` ✓ (4 tests)

- [x] **2.2.2** Test bulk sign-off with real transactions
  - Files: `tests/integration/advancement.test.ts`
  - Flow: Multiple requirements → Bulk sign-off → Verify all updated
  - Test: `npm test -- integration/advancement` ✓ (3 tests + 2 data integrity tests)

---

### Phase 3: Lib & Utility Coverage

#### 3.1 Utility Functions
- [x] **3.1.1** Test `notes-utils.ts` functions
  - Files: `tests/unit/notes-utils.test.ts`
  - Cases: parseNotes, formatNoteTimestamp, appendNote
  - Test: `npm test -- notes-utils` ✓ (23 tests)

- [x] **3.1.2** Test `feature-flags.ts` functions
  - Files: `tests/unit/feature-flags.test.ts`
  - Cases: isFeatureEnabled, flag combinations
  - Test: `npm test -- feature-flags` ✓ (19 tests)

#### 3.2 Remaining Actions
- [x] **3.2.1** Test `onboarding.ts` core functions
  - Files: `tests/unit/actions/onboarding.test.ts`
  - Cases: CSV extraction, roster parsing, edge cases
  - Test: `npm test -- onboarding` ✓ (10 tests)

---

<!-- MVP BOUNDARY - Everything above is required for 80% target -->

### Phase 4: Extended Coverage (Post-MVP)

#### 4.1 API Routes
- [ ] **4.1.1** Test scoutbook sync API routes
  - Files: `tests/unit/api/scoutbook-sync.test.ts`
  - Cases: Sync initiation, status check, error handling

- [ ] **4.1.2** Test billing notification routes
  - Files: `tests/unit/api/billing-notifications.test.ts`
  - Cases: Email triggers, payment confirmations

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `tests/mocks/fixtures/advancement.ts` | Advancement-specific test fixtures |
| `tests/mocks/fixtures/scoutbook.ts` | Scoutbook import test data |
| `tests/unit/actions/advancement.test.ts` | Advancement action unit tests |
| `tests/unit/actions/scoutbook-import.test.ts` | Scoutbook import unit tests |
| `tests/unit/actions/onboarding.test.ts` | Onboarding action tests |
| `tests/unit/notes-utils.test.ts` | Notes utility tests |
| `tests/unit/feature-flags.test.ts` | Feature flag tests |
| `tests/integration/setup.ts` | Integration test utilities |
| `tests/integration/advancement.test.ts` | Advancement integration tests |

### Modified Files
| File | Changes |
|------|---------|
| `tests/mocks/supabase.ts` | Add advancement query helpers |
| `tests/mocks/fixtures/index.ts` | Export new fixtures |
| `vitest.config.ts` | Add integration test configuration |
| `package.json` | Add integration test script |

---

## 5. Testing Strategy

### Unit Tests (Phase 1 & 3)
- Mock all Supabase calls
- Test auth → permission → action → response flow
- Cover error cases for each failure point
- Use existing mock patterns from profile/funds tests

### Integration Tests (Phase 2)
- Use real test Supabase instance
- Seed known data before tests
- Clean up after each test suite
- Test actual database transactions and RLS policies

### Coverage Verification
- Run `npm test -- --coverage` after each phase
- Track coverage per file in task log
- Target 80% overall before marking complete

---

## 6. Rollout Plan

### Dependencies
- Test Supabase instance for integration tests (can use dev instance)
- No production changes required
- No migrations needed

### Execution Steps
1. Complete Phase 0 (fixtures and infrastructure)
2. Complete Phase 1 (critical action tests)
3. Run coverage report - should be near 75%
4. Complete Phase 2 (integration tests)
5. Complete Phase 3 (remaining coverage)
6. Final coverage report - should be ≥80%

### Verification
- `npm test` passes all tests
- `npm test -- --coverage` shows ≥80% statements
- No regressions in existing functionality

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 | 3 | 3 | ✅ Complete |
| Phase 1 | 10 | 10 | ✅ Complete |
| Phase 2 | 4 | 4 | ✅ Complete |
| Phase 3 | 3 | 3 | ✅ Complete |
| **Total** | **20** | **20** | ✅ Complete |

---

## 8. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| | | | |

---

## Approval

- [ ] Requirements reviewed by: _____
- [ ] Technical design reviewed by: _____
- [ ] Ready for implementation
