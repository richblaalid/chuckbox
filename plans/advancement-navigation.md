# URL-Synced Advancement Navigation

## Context

The advancement page (`/advancement`) uses pure React state for tab switching, merit badge selection, and rank selection. When a user refreshes the browser while viewing a specific merit badge's requirements, they lose that view and return to the default tab. When they click browser "Back" from a badge detail view, it navigates away from the advancement page entirely instead of returning to the badge grid. The same issue affects rank selection — viewing Second Class requirements and refreshing drops back to Scout.

Additionally, the current `<Tabs defaultValue>` implementation unmounts tab content when switching away, destroying `LazyMeritBadgeBrowser`'s loaded badges/scouts and `LazyRankBrowser`'s cached rank data. Switching back to a previously-visited tab re-fetches all data.

**Goal:** Sync navigation state to URL search params so refresh preserves the view and browser back/forward work intuitively. Preserve tab content across switches to avoid redundant data fetching.

## URL Format

| URL | View |
|-----|------|
| `/advancement` | Redirects to `?tab=ranks` (default) |
| `/advancement?tab=ranks` | Ranks tab, default rank (Scout) |
| `/advancement?tab=ranks&rank=second_class` | Ranks tab, specific rank selected |
| `/advancement?tab=badges` | Merit Badges grid |
| `/advancement?tab=badges&badge=<uuid>` | Specific merit badge requirements |
| `/advancement?tab=summary` | Summary tab |

## Files to Modify

| File | Change Scope |
|------|-------------|
| `src/components/advancement/unit-advancement-tabs.tsx` | Major: controlled tabs, forceMount+hidden, URL sync, rank/badge callbacks |
| `src/components/advancement/merit-badge-browser.tsx` | Major: URL-driven selection, requirements cache, flash prevention |
| `src/components/advancement/lazy-merit-badge-browser.tsx` | Minor: pass through `selectedBadgeId` and `onBadgeChange` props |
| `src/components/advancement/lazy-rank-browser.tsx` | Moderate: accept `selectedRankCode` prop, call `onRankChange` callback |

No new files. No server component changes. No database changes.

## Implementation

### 1. `unit-advancement-tabs.tsx` — URL-controlled tabs with forceMount

**Imports:** Add `useSearchParams`, `useRouter`, `usePathname` from `next/navigation`.

**Derive state from URL:**
```
activeTab  = searchParams.get('tab') || initialTab     // 'ranks' | 'badges' | 'summary'
badgeId    = searchParams.get('badge') || null          // UUID or null
rankCode   = searchParams.get('rank') || null           // rank code or null
```

**Controlled tabs:**
- Change `<Tabs defaultValue={initialTab}>` to `<Tabs value={activeTab}>`
- `onValueChange` calls `handleTabChange`

**Tab switching uses `router.replace`** (not `push`):
- Tabs are lateral navigation — switching tabs should not create history entries
- This prevents the "10 clicks of Back to leave the page" problem
- `handleTabChange(value)`: `router.replace('?tab=' + value, { scroll: false })`
- Also updates `visitedTabs`

**Depth navigation uses `router.push`:**
- `handleBadgeChange(badgeId | null)`:
  - Select: `router.push('?tab=badges&badge=' + badgeId, { scroll: false })`
  - Deselect: `router.push('?tab=badges', { scroll: false })`
- `handleRankChange(rankCode | null)`:
  - Select: `router.push('?tab=ranks&rank=' + rankCode, { scroll: false })`
  - Deselect: `router.replace('?tab=ranks', { scroll: false })` (rank default doesn't need history)

**forceMount + CSS hiding** to preserve component trees:
```tsx
<TabsContent value="ranks" forceMount className="data-[state=inactive]:hidden mt-4">
  {visitedTabs.has('ranks') && (
    <LazyRankBrowser
      selectedRankCode={rankCode}
      onRankChange={handleRankChange}
      ...
    />
  )}
</TabsContent>

<TabsContent value="badges" forceMount className="data-[state=inactive]:hidden mt-4">
  {visitedTabs.has('badges') && (
    <LazyMeritBadgeBrowser
      selectedBadgeId={badgeId}
      onBadgeChange={handleBadgeChange}
      ...
    />
  )}
</TabsContent>

<TabsContent value="summary" forceMount className="data-[state=inactive]:hidden mt-4">
  {visitedTabs.has('summary') && <LazySummaryView ... />}
</TabsContent>
```

- `forceMount`: Radix keeps the DOM node alive regardless of active tab
- `data-[state=inactive]:hidden`: Tailwind hides inactive tabs via CSS
- `visitedTabs` still gates **initial** rendering (lazy load on first visit)
- Once mounted, the component tree stays alive across tab switches

### 2. `lazy-merit-badge-browser.tsx` — Prop pass-through

Add to interface and pass through to `MeritBadgeBrowser`:
- `selectedBadgeId?: string | null`
- `onBadgeChange?: (badgeId: string | null) => void`

### 3. `merit-badge-browser.tsx` — URL-driven selection with cache

**New props:**
- `selectedBadgeId?: string | null` — from URL search param
- `onBadgeChange?: (badgeId: string | null) => void` — callback to update URL

**Requirements cache** (avoids re-fetching on back-navigation):
```tsx
const requirementsCache = useRef<Map<string, BsaMeritBadgeRequirement[]>>(new Map())
```

Update `handleBadgeClick` to check cache before fetching:
```tsx
const cached = requirementsCache.current.get(badge.id)
if (cached) {
  setBadgeRequirements(cached)
  setSelectedBadge(badge)
  onBadgeChange?.(badge.id)
  return
}
// ... existing fetch logic, then cache the result:
requirementsCache.current.set(badge.id, reqs)
```

**URL sync via useEffect** watching `[selectedBadgeId, badges]`:

```tsx
useEffect(() => {
  // Already in sync — skip
  if (selectedBadgeId === selectedBadge?.id) return
  if (selectedBadgeId === null && selectedBadge === null) return

  // URL says no badge → clear selection (browser Back)
  if (selectedBadgeId === null) {
    setSelectedBadge(null)
    setBadgeRequirements([])
    return
  }

  // URL says badge selected but badges haven't loaded yet → wait
  if (badges.length === 0) return

  // Find and select the badge
  const badge = badges.find(b => b.id === selectedBadgeId)
  if (badge) {
    // Check cache first, then fetch if needed
    const cached = requirementsCache.current.get(badge.id)
    if (cached) {
      setSelectedBadge(badge)
      setBadgeRequirements(cached)
    } else {
      handleBadgeClick(badge)  // fetches and caches
    }
  }
}, [selectedBadgeId, badges])
```

This approach compares `selectedBadgeId` (from URL) with `selectedBadge?.id` (component state) to determine if action is needed. No ref needed — the state comparison is sufficient.

**Click handler** calls `onBadgeChange` to update URL:
```tsx
const handleBadgeClick = async (badge: MeritBadge) => {
  setSelectedBadge(badge)
  onBadgeChange?.(badge.id)
  // ... fetch requirements (with cache check)
}
```

**Back handler:**
```tsx
const handleBack = () => {
  setSelectedBadge(null)
  setBadgeRequirements([])
  onBadgeChange?.(null)
}
```

**Flash prevention on refresh:** When `selectedBadgeId` is set but `badges` haven't loaded yet, skip rendering the grid. Show a loading state instead:
```tsx
// At the top of the render, before the grid
if (!selectedBadge && selectedBadgeId && badges.length === 0) {
  return <BadgeDetailSkeleton />  // or a simple spinner
}
```

This prevents the momentary flash of the badge grid when refreshing with a badge deep-link.

### 4. `lazy-rank-browser.tsx` — Accept rank selection from URL

**New props:**
- `selectedRankCode?: string | null` — from URL search param
- `onRankChange?: (rankCode: string | null) => void` — callback to update URL

**Changes to existing logic:**

Currently, `LazyRankBrowser` manages `selectedRankCode` as internal state and defaults to `ranks[0]?.code`. Change this to be controlled when a prop is provided:

```tsx
// Default selection: use URL param if provided, otherwise first rank
useEffect(() => {
  if (ranks.length > 0 && internalSelectedCode === null) {
    const initial = selectedRankCodeProp || ranks[0].code
    setInternalSelectedCode(initial)
  }
}, [ranks, selectedRankCodeProp])
```

**Sync URL prop changes** (e.g., browser Back changes `?rank=` param):
```tsx
useEffect(() => {
  if (selectedRankCodeProp === null) return // no URL override
  if (selectedRankCodeProp === internalSelectedCode) return // already in sync
  setInternalSelectedCode(selectedRankCodeProp)
}, [selectedRankCodeProp])
```

**Update click handler** to call `onRankChange`:
```tsx
const handleRankSelect = useCallback((code: string) => {
  setInternalSelectedCode(code)
  onRankChange?.(code)
}, [onRankChange])
```

## Key Design Decisions

1. **`router.replace` for tabs, `router.push` for depth navigation** — Tab switches are lateral (don't pollute history). Badge/rank selection is depth navigation (Back returns to the list). This gives intuitive Back button behavior without history stack pollution.

2. **`{ scroll: false }`** on all URL changes — prevents scroll-to-top, keeping the user's viewport position.

3. **`forceMount` + `data-[state=inactive]:hidden`** — Radix keeps DOM alive; Tailwind hides inactive tabs with CSS. The `visitedTabs` Set gates initial mount (lazy loading) but once a tab's component is mounted, it stays alive. This preserves `LazyMeritBadgeBrowser`'s 141-badge dataset and `LazyRankBrowser`'s per-rank cache across tab switches.

4. **State comparison instead of refs** — The URL sync `useEffect` compares `selectedBadgeId` (prop from URL) against `selectedBadge?.id` (component state). When they match, the effect is a no-op. This avoids the fragility of a `userSelectedRef` approach.

5. **Requirements cache in MeritBadgeBrowser** — A `Map<string, Requirements[]>` ref caches fetched requirements. Back-navigation to a previously-viewed badge is instant. Mirrors the pattern already used by `LazyRankBrowser`'s `rankDataCache`.

6. **Flash prevention** — When refreshing with `?badge=<uuid>`, the component shows a loading skeleton instead of briefly flashing the badge grid while badges load.

## Verification

1. `npm run build` — must pass with no errors
2. `npm test` — no regressions
3. Manual testing:

**Tab navigation:**
- Navigate to `/advancement` → defaults to Ranks tab, URL shows `?tab=ranks`
- Click "Merit Badges" tab → URL updates to `?tab=badges`
- Click "Summary" tab → URL updates to `?tab=summary`
- Click browser Back → does NOT cycle through tabs (replace, not push)
- Click browser Back → leaves advancement page

**Badge deep-linking:**
- Click "Merit Badges" tab → click a badge → URL shows `?tab=badges&badge=<uuid>`
- Refresh browser → same badge requirements view preserved (no grid flash)
- Click browser Back → returns to badge grid (`?tab=badges`), requirements cleared
- Click the same badge again → requirements load instantly from cache

**Rank deep-linking:**
- Click "Ranks" tab → select Second Class → URL shows `?tab=ranks&rank=second_class`
- Refresh browser → Second Class requirements preserved
- Click browser Back → returns to default rank view

**Tab content preservation:**
- Load Merit Badges tab (141 badges load)
- Switch to Ranks tab
- Switch back to Merit Badges → badges appear instantly (no re-fetch, no skeleton)
