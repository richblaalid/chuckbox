# PR #6 Fixes - LCP Optimization Issues

> **Status:** Ready for Implementation
> **Created:** 2026-02-06
> **PR:** #6 (audit/phase-2-performance)

---

## Issues to Fix

| # | Priority | Issue | Impact |
|---|----------|-------|--------|
| 1 | 🔴 Critical | Integration tests failing | Blocks merge |
| 2 | 🟡 Medium | Race condition in LazyRankBrowser | Unnecessary re-fetches |
| 3 | 🟢 Low | Duplicate scout queries | Minor perf overhead |
| 4 | 🟢 Low | Hardcoded default rank | Edge case for non-troop units |

**Note:** Issue #4 from review (Missing Error Boundary) is deferred - current error handling is functional and error boundaries require more architectural consideration.

---

## Tasks

### 1. Fix Failing Integration Tests
**Priority:** 🔴 Critical
**Files:** `tests/integration/advancement.test.ts`

**Problem:** Tests call `ctx.trackRankProgress()` which doesn't exist on the test context.

**Solution:** Add the `trackRankProgress` method to the test context, similar to existing tracking methods.

```typescript
// Need to add to test context interface and implementation
trackRankProgress(id: string): void
```

**Steps:**
- [x] **1.1** Check existing test context for tracking pattern
- [x] **1.2** Add `trackRankProgress` to test context
- [x] **1.3** Verify all 4 failing tests pass

---

### 2. Fix Race Condition in LazyRankBrowser
**Priority:** 🟡 Medium
**Files:** `src/components/advancement/lazy-rank-browser.tsx`

**Problem:** `loadRankData` is in useEffect dependency array but recreated on render, causing potential re-fetches.

**Current Code (lines 226-234):**
```typescript
useEffect(() => {
  if (ranks.length === 0) return
  const selectedRank = ranks.find(r => r.code === selectedRankCode)
  if (selectedRank) {
    loadRankData(selectedRank.id)
  }
}, [selectedRankCode, ranks, loadRankData])
```

**Solution:** Move cache check into the effect and remove `loadRankData` from dependencies:

```typescript
useEffect(() => {
  if (ranks.length === 0) return
  const selectedRank = ranks.find(r => r.code === selectedRankCode)
  if (!selectedRank) return

  // Check cache first (moved inside effect)
  if (rankDataCache.current.has(selectedRank.id)) {
    setCurrentRankData(rankDataCache.current.get(selectedRank.id)!)
    return
  }

  // Load data
  let cancelled = false
  async function load() {
    setRankDataLoading(true)
    try {
      const result = await getRankDataForRank(unitId, selectedRank.id)
      if (cancelled) return
      if (!result.success) {
        console.error('Failed to load rank data:', result.error)
        return
      }
      const data = {
        requirements: result.data?.requirements || [],
        scoutProgress: result.data?.scoutProgress || [],
      }
      rankDataCache.current.set(selectedRank.id, data)
      setCurrentRankData(data)
    } finally {
      if (!cancelled) setRankDataLoading(false)
    }
  }
  load()
  return () => { cancelled = true }
}, [selectedRankCode, ranks, unitId])
```

**Steps:**
- [x] **2.1** Refactor useEffect to inline data loading
- [x] **2.2** Add cleanup function to prevent state updates after unmount
- [x] **2.3** Remove unused `loadRankData` useCallback (kept handleRankSelect)
- [x] **2.4** Test rank switching behavior (build passes)

---

### 3. Eliminate Duplicate Scout Queries
**Priority:** 🟢 Low
**Files:** `src/components/advancement/advancement-content-loader.tsx`

**Problem:** Scouts are queried twice:
1. In `getUnitAdvancementSummary()` - returns full scout list
2. In `pendingBadgeApprovalsPromise` - queries scout IDs again

**Solution:** Await summary first, then use its scout IDs for badge approvals query.

**Current flow:**
```
Promise.all([
  summaryPromise,           // Fetches scouts
  pendingBadgeApprovalsPromise,  // ALSO fetches scout IDs
  ...
])
```

**Optimized flow:**
```
// 1. Get summary first (has scout IDs)
const summaryResult = await summaryPromise

// 2. Use scout IDs from summary for badge approvals
const scoutIds = summaryResult.data?.scouts.map(s => s.id) || []
const pendingBadgeApprovalsPromise = scoutIds.length > 0
  ? supabase.from('scout_merit_badge_progress')...
  : Promise.resolve({ data: [] })

// 3. Remaining queries can still run in parallel
const [pendingApprovalsResult, ...] = await Promise.all([...])
```

**Trade-off:** This adds a sequential dependency but eliminates a redundant query. Net effect should be neutral or slightly positive.

**Steps:**
- [x] **3.1** Refactor to await summary first
- [x] **3.2** Extract scout IDs from summary result
- [x] **3.3** Use extracted IDs for badge approvals query
- [x] **3.4** Keep other queries parallel

---

### 4. Make Default Rank Configurable
**Priority:** 🟢 Low
**Files:** `src/components/advancement/lazy-rank-browser.tsx`

**Problem:** Hardcoded `'scout'` as default rank assumes Boy Scout Troop program.

**Solution:** Default to first rank in the sorted list, or accept a prop.

```typescript
// Instead of:
const [selectedRankCode, setSelectedRankCode] = useState<string>('scout')

// Use:
const [selectedRankCode, setSelectedRankCode] = useState<string | null>(null)

// Then in effect when ranks load:
useEffect(() => {
  if (ranks.length > 0 && selectedRankCode === null) {
    setSelectedRankCode(ranks[0].code)
  }
}, [ranks, selectedRankCode])
```

**Steps:**
- [x] **4.1** Change initial state to `null`
- [x] **4.2** Add effect to set default when ranks load
- [x] **4.3** Handle null state in render (show skeleton)

---

## Implementation Order

1. **Task 1** - Fix tests (blocks merge)
2. **Task 2** - Fix race condition (improves reliability)
3. **Task 3** - Optimize queries (minor perf)
4. **Task 4** - Default rank (edge case)

---

## Verification

After all fixes:
- [x] `npm test` passes (0 failures)
- [x] `npm run build` succeeds
- [ ] Manual test: Navigate to /advancement, switch ranks, verify no console errors
- [ ] Manual test: Check Summary tab lazy-loads correctly

---

## Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 1 | 2026-02-06 | 979edae | Added trackRankProgress to TestContext, added timeouts to integration tests |
| 2 | 2026-02-06 | 8eab1eb | Fixed race condition in LazyRankBrowser useEffect |
| 3 | 2026-02-06 | c1a33da | Eliminated duplicate scout queries |
| 4 | 2026-02-06 | pending | Made default rank configurable |
