# Test Coverage Improvement Plan

## Status: APPROVED
**Created**: 2026-02-21
**Approach**: Two-phase — E2E smoke tests first (Phase A), bottom-up unit test sweep second (Phase B)

---

## Current State

- **822 tests** across 40 test files
- **45% statement coverage**, 41% branch, 54% function
- **37 of 391 source files** (~9.5%) have any test coverage
- Strong coverage: business logic (billing, parsing, advancement actions)
- Major gaps: UI components (3.7%), API routes (4.7%), hooks (0%)

## Goal

Increase deploy confidence across all critical user-facing paths. Catch "the page is completely broken" regressions before shipping.

---

## Phase A: E2E Smoke Tests (Playwright)

### Architecture

- Run against dev Supabase (`feownmcpkfugkcivdoal`) with seeded test data
- Use existing test user credentials (admin, treasurer, leader, parent, scout)
- Auth via `storageState` — login once per file, reuse cookies
- Each test is a smoke test covering the critical happy path

### Directory Structure

```
tests/
  e2e/
    fixtures/
      auth.ts          # Login helper, storageState management
      navigation.ts    # Common nav helpers
    smoke/
      01-login.spec.ts
      02-dashboard.spec.ts
      03-roster.spec.ts
      04-advancement.spec.ts
      05-finances.spec.ts
      06-billing.spec.ts
      07-payments.spec.ts
      08-settings.spec.ts
    playwright.config.ts
```

### 8 Critical User Journeys

| # | Flow | Role | Validates |
|---|------|------|-----------|
| 1 | Login | all | Auth flow, redirect to dashboard |
| 2 | Dashboard | admin | Dashboard loads, unit data, nav works |
| 3 | Roster | admin | Scout list renders, scout detail opens |
| 4 | Advancement | leader | Badge list loads, badge detail, requirements display |
| 5 | Finances | treasurer | Account table, balances, scout account detail |
| 6 | Billing | treasurer | Create billing record, charges appear |
| 7 | Payments | treasurer | Payment recording flow |
| 8 | Settings | admin | Users tab loads, unit settings accessible |

### Scripts

```bash
npm run test:e2e        # Run all E2E smoke tests
npm run test:e2e:ui     # Playwright UI for debugging
```

### Prerequisites

- Dev server running on port 3000
- Dev database seeded (`npm run db:seed:all`)

---

## Phase B: Bottom-Up Unit Test Sweep (Fast Follow)

### Priority Order

1. **Untested server actions** (14 remaining) — critical business logic
2. **Complex UI components** — advancement panels, billing tables, payment flows
3. **API routes** — webhook handlers, payment endpoints
4. **Custom hooks** — form state, Square payments

### Target

- 70%+ statement coverage
- All server actions tested
- All complex components with conditional logic tested

---

## Not In Scope

- CI pipeline integration (future)
- Visual regression testing
- Performance/load testing
- Mobile-specific E2E tests

---

## Task Log

| Date | Task | Commit |
|------|------|--------|
| | | |
