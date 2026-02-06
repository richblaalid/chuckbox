# Advancement Page LCP Optimization

> **Status:** Draft
> **Created:** 2026-02-05
> **Author:** Claude

---

## 1. Requirements

### 1.1 Problem Statement

The `/advancement` page has an 8.13s Largest Contentful Paint (LCP), far exceeding Google's recommended ≤2.5s threshold. Users wait too long before seeing meaningful content, degrading the experience.

**Root Cause:** The page is a Server Component that blocks rendering until 6 database queries complete. The largest query (`getRankBrowserData`) fetches deeply nested data (scouts → rank_progress → requirement_progress) that can return thousands of rows.

### 1.2 User Stories

- [x] As a leader, I want the advancement page to show content quickly so I don't wait 8+ seconds staring at a blank screen
- [x] As a leader, I want to see progress indicators while data loads so I know the page is working

### 1.3 Acceptance Criteria

- [ ] LCP ≤ 2.5 seconds (from 8.13s baseline)
- [ ] Header and stats render immediately (within 500ms)
- [ ] Skeleton loading provides visual feedback during data fetch
- [ ] All existing functionality preserved
- [ ] No regressions in data accuracy

### 1.4 Out of Scope

- Database schema changes
- Redis/external caching infrastructure
- Merit Badge tab optimization (already lazy-loaded)
- Server-side rendering mode changes

### 1.5 Open Questions

| Question | Answer | Decided By |
|----------|--------|------------|
| Target LCP? | ≤2.5s (aggressive) | User |
| Unit size? | Medium (20-50 scouts) | User |
| Loading UX preference? | Skeleton loading | User |

---

## 2. Technical Design

### 2.1 Approach

**Strategy: Progressive Rendering with Suspense**

Instead of waiting for all queries to complete before rendering anything, we'll:

1. **Render static content immediately** - Header, page structure
2. **Stream data-dependent sections** - Use Suspense boundaries around each major section
3. **Optimize queries** - Parallelize, reduce nesting, defer non-critical data
4. **Show skeletons** - Display loading states while data streams in

**Why this approach:**
- Next.js App Router natively supports streaming with Suspense
- No infrastructure changes needed (no Redis, no caching layer)
- Maintains existing component structure with minimal refactoring
- Proven pattern in Next.js ecosystem

### 2.2 Database Changes

None required. Query optimization only.

### 2.3 API/Server Actions

| Action | Change |
|--------|--------|
| `getUnitAdvancementSummary` | No change - already optimized |
| `getRankBrowserData` | Split into two queries to reduce nesting |
| `getRankRequirementsForUnit` | No change - static reference data |

### 2.4 UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AdvancementPageContent` | `src/components/advancement/advancement-page-content.tsx` | New async component for Suspense streaming |
| `UnitAdvancementStats` | Existing | Will receive data as props from streamed parent |
| `loading.tsx` | Existing | Already in place - no changes needed |

### 2.5 Architecture Diagram

**Current (Blocking):**
```
Browser Request
      │
      ▼
┌─────────────────────────────────────┐
│  Server Component                    │
│  ┌─────────────────────────────────┐│
│  │ Promise.all([                   ││
│  │   query1,                       ││  ← All queries must complete
│  │   query2,                       ││    before ANY render
│  │   query3,                       ││
│  │   query4,                       ││
│  │   query5                        ││
│  │ ])                              ││
│  └─────────────────────────────────┘│
│               │                      │
│               ▼                      │
│  ┌─────────────────────────────────┐│
│  │ Render ALL content              ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
      │
      ▼
Browser receives complete HTML (8s+ later)
```

**Proposed (Streaming):**
```
Browser Request
      │
      ▼
┌─────────────────────────────────────┐
│  Server Component (page.tsx)         │
│  ┌─────────────────────────────────┐│
│  │ Render Header immediately       ││ ← Instant (no data needed)
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ <Suspense fallback={Skeleton}>  ││
│  │   <StatsSection /> ← async      ││ ← Streams when ready
│  │ </Suspense>                     ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ <Suspense fallback={Skeleton}>  ││
│  │   <TabsContent /> ← async       ││ ← Streams when ready
│  │ </Suspense>                     ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
      │
      ▼
Browser receives:
  - Header instantly (~100ms)
  - Stats section streams in (~500ms)
  - Tabs content streams in (~1-2s)
```

---

## 3. Implementation Tasks

**Task Numbering:** `{Phase}.{Section}.{Task}` (e.g., 0.1.1, 1.2.3)

### Phase 1: Quick Wins (Immediate Impact)

#### 1.1 Parallelize Sequential Query
- [x] **1.1.1** Move `rankProgressData` query into `Promise.all`
  - Files: `src/app/(dashboard)/advancement/page.tsx`
  - Test: Query runs in parallel, not sequentially
  - Impact: Eliminates ~200-500ms sequential wait

#### 1.2 Optimize Large Nested Query
- [x] **1.2.1** Split `getRankBrowserData` into two separate queries
  - Files: `src/app/actions/advancement/queries.ts`
  - Test: Returns same data with flatter structure
  - Impact: Reduces query complexity, potentially faster execution

- [ ] **1.2.2** Reduce nested select depth where possible
  - Files: `src/app/actions/advancement/queries.ts`
  - Test: Queries return minimal required fields
  - Impact: Less data transferred

---

### Phase 2: Streaming Architecture (Major Impact)

#### 2.1 Create Async Data Components
- [ ] **2.1.1** Create `AdvancementStatsLoader` async component
  - Files: `src/components/advancement/advancement-stats-loader.tsx`
  - Test: Component fetches and renders stats independently
  - Purpose: Wrap stats data fetching for Suspense streaming

- [ ] **2.1.2** Create `AdvancementTabsLoader` async component
  - Files: `src/components/advancement/advancement-tabs-loader.tsx`
  - Test: Component fetches and renders tabs independently
  - Purpose: Wrap tabs data fetching for Suspense streaming

#### 2.2 Add Suspense Boundaries
- [ ] **2.2.1** Refactor page.tsx to use Suspense boundaries
  - Files: `src/app/(dashboard)/advancement/page.tsx`
  - Test: Header renders instantly, sections stream progressively
  - Purpose: Enable progressive HTML streaming

- [ ] **2.2.2** Create skeleton components for each Suspense boundary
  - Files: `src/components/advancement/advancement-skeletons.tsx`
  - Test: Skeletons match actual content layout
  - Purpose: Provide visual feedback during streaming

#### 2.3 Optimize Data Flow
- [ ] **2.3.1** Pass only essential data through Suspense boundaries
  - Files: Multiple advancement components
  - Test: No unnecessary data re-fetching
  - Purpose: Minimize data passed between boundaries

---

<!-- MVP BOUNDARY - Phase 1 + 2 required for ≤2.5s target -->

### Phase 3: Advanced Optimizations (If Needed)

#### 3.1 Query Caching
- [ ] **3.1.1** Add React cache() for rank requirements (static data)
  - Files: `src/app/actions/advancement/queries.ts`
  - Test: Same request doesn't re-query database
  - Purpose: Cache static reference data within request

- [ ] **3.1.2** Consider unstable_cache for cross-request caching
  - Files: `src/app/actions/advancement/queries.ts`
  - Test: Subsequent page loads use cached data
  - Purpose: Cache badge/rank reference data

#### 3.2 Data Pagination
- [ ] **3.2.1** Add pagination to rank browser data
  - Files: `src/app/actions/advancement/queries.ts`, component files
  - Test: Initial load fetches first page only
  - Purpose: Reduce initial data volume for large units

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/components/advancement/advancement-stats-loader.tsx` | Async component for stats streaming |
| `src/components/advancement/advancement-tabs-loader.tsx` | Async component for tabs streaming |
| `src/components/advancement/advancement-skeletons.tsx` | Skeleton components for Suspense fallbacks |

### Modified Files
| File | Changes |
|------|---------|
| `src/app/(dashboard)/advancement/page.tsx` | Add Suspense boundaries, remove blocking queries |
| `src/app/actions/advancement/queries.ts` | Optimize query structure, reduce nesting |
| `src/components/advancement/unit-advancement-content.tsx` | May need minor adjustments for new data flow |

---

## 5. Testing Strategy

### Performance Testing
- [ ] Measure LCP before (baseline: 8.13s)
- [ ] Measure LCP after Phase 1 (target: <5s)
- [ ] Measure LCP after Phase 2 (target: ≤2.5s)
- [ ] Test with Chrome DevTools Performance tab
- [ ] Test with Lighthouse

### Functional Testing
- [ ] Verify all stats display correctly
- [ ] Verify Ranks tab loads with correct data
- [ ] Verify Merit Badges tab still lazy-loads correctly
- [ ] Verify Summary tab calculations work
- [ ] Verify pending approvals modal works

### Manual Testing
- [ ] Navigate to /advancement from dashboard
- [ ] Observe progressive loading (header → stats → tabs)
- [ ] Verify no flash of unstyled content
- [ ] Test on slow 3G network throttling

---

## 6. Rollout Plan

### Dependencies
- None - all changes are internal optimizations

### Migration Steps
1. Deploy Phase 1 changes
2. Measure improvement
3. Deploy Phase 2 changes
4. Measure final LCP
5. If needed, implement Phase 3

### Verification
- Check LCP in Chrome DevTools
- Monitor for any console errors
- Verify all existing functionality

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 1 | 3 | 0 | ⬜ Not Started |
| Phase 2 | 5 | 0 | ⬜ Not Started |
| Phase 3 | 2 | 0 | ⬜ Not Started |

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
