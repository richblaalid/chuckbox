# Pending Sign-offs Dashboard Component

## Overview

Create a dashboard card component that shows parent-submitted advancement requirements awaiting leader approval. Leaders can quickly approve or deny items directly from the dashboard.

## Requirements

### User Value
- **Who**: Leaders (admin, treasurer, leader roles)
- **Problem**: Currently no visibility into pending parent submissions on the dashboard
- **Solution**: Dashboard card showing oldest pending items with one-click approve/deny

### Scope
**In Scope**:
- Combined list of rank AND merit badge pending sign-offs
- Inline approve (one-click) and deny (with reason input) actions
- FIFO ordering (oldest submissions first)
- Show up to 5 items, "View all" link for more
- Real-time list updates after approve/deny

**Out of Scope**:
- Full approval management page (use existing advancement page)
- Bulk approve from dashboard (use existing modal on advancement page)
- Push notifications for new submissions

### Success Criteria
1. Dashboard shows pending sign-offs count and list
2. Leaders can approve with one click
3. Leaders can deny with reason
4. List updates immediately after action
5. Empty state shows "All caught up!" message

## Technical Design

### Data Sources
```sql
-- Rank requirements pending approval
SELECT * FROM scout_rank_requirement_progress
WHERE approval_status = 'pending_approval'
ORDER BY submitted_at ASC

-- Merit badge requirements pending approval
SELECT * FROM scout_merit_badge_requirement_progress
WHERE approval_status = 'pending_approval'
ORDER BY submitted_at ASC
```

### Component Architecture
```
DashboardPage (Server Component)
├── PendingSignoffsCard (Server Component - data fetch)
│   └── PendingSignoffsList (Client Component - actions)
│       ├── PendingSignoffItem (approve/deny buttons)
│       └── EmptyState ("All caught up!")
```

### Server Actions (extend existing)
- `approveRequirement(id, type: 'rank' | 'merit_badge')` - single approve
- `denyRequirement(id, type, reason)` - single deny with reason

### UI Design
```
┌─────────────────────────────────────────────────────────────┐
│ Pending Sign-offs                               View all →  │
├─────────────────────────────────────────────────────────────┤
│ 🏅 John Smith • 1st Class 4a                    ✓    ✗     │
│    "Completed at camp on Jan 5" • Jane (Mom) • 5 days ago  │
├─────────────────────────────────────────────────────────────┤
│ 🎖️ Sarah Lee • Camping MB Req 7b                ✓    ✗     │
│    "Did this at summer camp" • Bob (Dad) • 3 days ago      │
├─────────────────────────────────────────────────────────────┤
│                    All caught up! 🎉                        │
│              No pending requirements to review              │
└─────────────────────────────────────────────────────────────┘

Icons: 🏅 = Rank, 🎖️ = Merit Badge (use Lucide icons)
Actions: ✓ = Check (green), ✗ = X (red, opens reason input)
```

## Implementation Tasks

### Phase 0: Foundation ✅

**0.1 Data Layer**
- [x] 0.1.1 Create `getPendingSignoffs()` query function in `src/app/actions/advancement/queries.ts`
- [x] 0.1.2 Add types for `PendingSignoff` in `src/types/advancement.ts`

**0.2 Server Actions**
- [x] 0.2.1 Add `approveRequirement()` action in `src/app/actions/advancement/signoff-actions.ts`
- [x] 0.2.2 Add `denyRequirement()` action with reason parameter

### Phase 1: Dashboard Component ✅

**1.1 Card Component**
- [x] 1.1.1 Create `PendingSignoffsCard` server component in `src/components/dashboard/pending-signoffs-card.tsx`
- [x] 1.1.2 Fetch and combine rank + merit badge pending items
- [x] 1.1.3 Sort by oldest first, limit to 5

**1.2 List Component**
- [x] 1.2.1 Create `PendingSignoffsList` client component for interactive list
- [x] 1.2.2 Implement `PendingSignoffItem` with approve/deny actions
- [x] 1.2.3 Add deny reason input (inline)
- [x] 1.2.4 Handle optimistic updates on approve/deny
- [x] 1.2.5 Add empty state with "All caught up!" message

**1.3 Dashboard Integration**
- [x] 1.3.1 Add `PendingSignoffsCard` to management dashboard layout
- [x] 1.3.2 Only show when ADVANCEMENT_TRACKING feature flag is enabled
- [x] 1.3.3 Add "View all" link to `/advancement?tab=pending`

### Phase 2: Polish

**2.1 Animations**
- [ ] 2.1.1 Add fade-out animation on approve/deny
- [ ] 2.1.2 Add slide-up for remaining items

**2.2 Testing**
- [ ] 2.2.1 Test with no pending items (empty state)
- [ ] 2.2.2 Test approve flow
- [ ] 2.2.3 Test deny flow with reason
- [ ] 2.2.4 Test with >5 items (View all link)

## Critical Files

| File | Action | Status |
|------|--------|--------|
| `src/app/actions/advancement/queries.ts` | Add getPendingSignoffs() | ✅ |
| `src/types/advancement.ts` | Add PendingSignoff type | ✅ |
| `src/app/actions/advancement/signoff-actions.ts` | Create server actions | ✅ |
| `src/components/dashboard/pending-signoffs-card.tsx` | Create component | ✅ |
| `src/components/dashboard/pending-signoffs-list.tsx` | Create client component | ✅ |
| `src/app/(dashboard)/dashboard/page.tsx` | Add card to dashboard | ✅ |

## Verification

1. **Data Query**: Pending items load correctly from both tables
2. **Approve**: One-click approve updates status, removes from list
3. **Deny**: Deny with reason updates status, stores reason, removes from list
4. **Empty State**: Shows "All caught up!" when no pending items
5. **Build**: `npm run build` passes

## Task Log

| Task | Date | Commit |
|------|------|--------|
| Phase 0 complete: types, query, server actions | 2026-02-10 | pending |
| Phase 1 complete: card, list, dashboard integration | 2026-02-10 | pending |
