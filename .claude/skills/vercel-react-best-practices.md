# Vercel React Best Practices

> Source: vercel-labs/agent-skills
> Version: 1.0.0

Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel Engineering. Contains 45 rules across 8 categories, prioritized by impact.

## When to Apply

Reference these guidelines when:
- Writing new React components or Next.js pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React/Next.js code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Eliminating Waterfalls | CRITICAL |
| 2 | Bundle Size Optimization | CRITICAL |
| 3 | Server-Side Performance | HIGH |
| 4 | Client-Side Data Fetching | MEDIUM-HIGH |
| 5 | Re-render Optimization | MEDIUM |
| 6 | Rendering Performance | MEDIUM |
| 7 | JavaScript Performance | LOW-MEDIUM |
| 8 | Advanced Patterns | LOW |

---

## 1. Eliminating Waterfalls (CRITICAL)

Waterfalls are the #1 performance killer. Sequential awaits add full network latency for each step.

### async-defer-await
Move `await` into branches where actually used.

```typescript
// BAD - awaits even if not needed
async function getData() {
  const data = await fetchData()
  if (condition) return cached
  return data
}

// GOOD - defer await to where needed
async function getData() {
  const dataPromise = fetchData()
  if (condition) return cached
  return await dataPromise
}
```

### async-parallel
Use `Promise.all()` for independent operations.

```typescript
// BAD - sequential
const user = await getUser(id)
const posts = await getPosts(id)
const comments = await getComments(id)

// GOOD - parallel
const [user, posts, comments] = await Promise.all([
  getUser(id),
  getPosts(id),
  getComments(id),
])
```

### async-suspense-boundaries
Use Suspense to stream content progressively.

```tsx
// GOOD - independent streaming
<Suspense fallback={<HeaderSkeleton />}>
  <Header />
</Suspense>
<Suspense fallback={<ContentSkeleton />}>
  <Content />
</Suspense>
```

---

## 2. Bundle Size Optimization (CRITICAL)

### bundle-barrel-imports
Import directly from source, avoid barrel files (index.ts re-exports).

```typescript
// BAD - loads entire package (200-800ms penalty)
import { Button } from '@/components'
import { formatDate } from 'date-fns'

// GOOD - direct imports
import { Button } from '@/components/ui/button'
import { formatDate } from 'date-fns/formatDate'
```

### bundle-dynamic-imports
Use `next/dynamic` for heavy components.

```tsx
// GOOD - code split heavy component
const HeavyChart = dynamic(() => import('./HeavyChart'), {
  loading: () => <ChartSkeleton />,
  ssr: false,
})
```

### bundle-defer-third-party
Load analytics/logging after hydration.

```tsx
// GOOD - defer analytics
useEffect(() => {
  import('analytics').then(({ init }) => init())
}, [])
```

---

## 3. Server-Side Performance (HIGH)

### server-cache-react
Use `React.cache()` for per-request deduplication.

```typescript
// GOOD - dedupe within same request
const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } })
})
```

### server-serialization
Minimize data passed to client components.

```tsx
// BAD - passes full user object
<ClientComponent user={user} />

// GOOD - pass only needed fields
<ClientComponent userName={user.name} userId={user.id} />
```

### server-parallel-fetching
Restructure components to parallelize fetches.

```tsx
// GOOD - parallel server components
async function Page() {
  return (
    <>
      <Suspense><UserData /></Suspense>
      <Suspense><PostsData /></Suspense>
    </>
  )
}
```

---

## 4. Re-render Optimization (MEDIUM)

### rerender-memo
Extract expensive work into memoized components.

```tsx
// GOOD - memoize expensive computation
const ExpensiveList = memo(function ExpensiveList({ items }) {
  return items.map(item => <ExpensiveItem key={item.id} {...item} />)
})
```

### rerender-derived-state
Subscribe to derived booleans, not raw values.

```tsx
// BAD - re-renders on every items change
const items = useStore(state => state.items)
const hasItems = items.length > 0

// GOOD - only re-renders when boolean changes
const hasItems = useStore(state => state.items.length > 0)
```

### rerender-functional-setstate
Use functional setState for stable callbacks.

```tsx
// BAD - recreates callback on every render
const increment = () => setCount(count + 1)

// GOOD - stable callback identity
const increment = useCallback(() => setCount(c => c + 1), [])
```

### rerender-lazy-state-init
Pass function to useState for expensive initial values.

```tsx
// BAD - expensive computation on every render
const [data] = useState(expensiveComputation())

// GOOD - only computed once
const [data] = useState(() => expensiveComputation())
```

---

## 5. JavaScript Performance (LOW-MEDIUM)

### js-index-maps
Build Map for repeated lookups (O(1) instead of O(n)).

```typescript
// BAD - O(n) lookup each time
users.find(u => u.id === targetId)

// GOOD - O(1) lookup
const userMap = new Map(users.map(u => [u.id, u]))
userMap.get(targetId)
```

### js-set-map-lookups
Use Set/Map for membership checks.

```typescript
// BAD - O(n) array includes
if (allowedIds.includes(id))

// GOOD - O(1) Set lookup
const allowedSet = new Set(allowedIds)
if (allowedSet.has(id))
```

### js-combine-iterations
Combine multiple filter/map into one loop.

```typescript
// BAD - iterates 3 times
const result = items
  .filter(x => x.active)
  .map(x => x.value)
  .filter(v => v > 0)

// GOOD - single iteration
const result = items.reduce((acc, x) => {
  if (x.active && x.value > 0) acc.push(x.value)
  return acc
}, [])
```

### js-early-exit
Return early from functions.

```typescript
// GOOD - early exit
function process(item) {
  if (!item) return null
  if (!item.active) return null
  return expensiveOperation(item)
}
```

---

## Quick Checklist

When reviewing React/Next.js code, check for:

- [ ] Sequential awaits that could be parallel
- [ ] Barrel file imports instead of direct imports
- [ ] Large components that should be dynamically imported
- [ ] Server components passing too much data to client
- [ ] Missing Suspense boundaries
- [ ] Callbacks recreated on every render
- [ ] Array lookups that could use Map/Set
- [ ] Multiple iterations that could be combined
