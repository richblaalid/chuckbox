---
status: approved
last_verified: 2026-05-13
---

# Scout Name on Billing-Records List Row

## Context

The billing-records page (`/finances/billing`) shows each billing record as a collapsed row with an expand chevron. To see which scouts are associated with a record, the user must expand it. For records that bill only a single scout (a common case — ad-hoc charges, individual fees), this is an extra click on every row to answer "who is this for?" — information the user almost always wants at scan time.

This spec adds a scout-identity subtext line under each record's description in the existing row layout. Single-scout records display the scout's name; multi-scout records display "Multiple Scouts."

This is item 2 of the billing-UX queue originally listed in conversation:
1. ✅ Partial-payment display (shipped May 12, 2026 — PR #32)
2. **Scout name on cards** ← this spec
3. Create-billing modal: line items ↔ total interaction
4. Parent emails: line-item detail

## Goals

- A treasurer scanning the billing-records list can identify single-scout records by name without expanding the row.
- Multi-scout records are unambiguously labeled "Multiple Scouts" so the user knows the row covers more than one person.
- Voided records (or records where every charge is voided) get no scout subtext — the existing strikethrough on the description already conveys "this is dead."

## Non-goals

- No changes to the data model — `scout_first_name` and `scout_last_name` already flow through `ChargeDetail`.
- No changes to the expanded view (per-charge rows already show the name).
- No changes to other billing-list surfaces (e.g., dashboards, reports). Only `/finances/billing` row layout.
- No changes to mobile layout structure beyond adding the new subtext.

## Status state machine (charge counting)

The displayed scout text is derived from the count of **active** (non-voided) charges on the record. The subtext is also fully suppressed when the record itself is voided, regardless of charge counts:

| `record.is_void` | Active charges | Subtext rendered |
|---|---|---|
| true | — | None (record is dead; description strikethrough already conveys it) |
| false | 0 | None (no active scouts to surface) |
| false | 1 | `${scout_first_name} ${scout_last_name}` (trimmed) |
| false | 2+ | `Multiple Scouts` |

"Active charges" means `record.charges.filter(c => !c.is_void)`. In normal operation, `record.is_void` and "all charges voided" are correlated (voiding a record cascades to its charges), but the subtext logic treats both predicates independently to be defensive against any drift.

**Edge: name fields blank or null.** The `ChargeDetail` mapping in `src/app/(dashboard)/finances/billing/page.tsx` already coalesces missing `scout_first_name` to `'Unknown'` and missing `scout_last_name` to `''`. The trimmed join handles both gracefully (`'Unknown'` alone if last is empty; both joined with a space otherwise).

## UI changes

### Row description column

The description column today renders:

```tsx
<div className="flex-1 min-w-0">
  <p className="text-sm font-medium truncate ...">
    {record.description}
  </p>
  <p className="text-xs text-stone-500 sm:hidden">
    {date} · {paidCount}/{activeCharges.length} paid
  </p>
</div>
```

Under this spec, a new subtext line for the scout(s) is added between the description and the mobile-only date/count line. It renders at all breakpoints:

```tsx
<div className="flex-1 min-w-0">
  <p className="text-sm font-medium truncate ...">
    {record.description}
  </p>
  {scoutDisplay && (
    <p className="text-xs text-stone-500 truncate">
      {scoutDisplay}
    </p>
  )}
  <p className="text-xs text-stone-500 sm:hidden">
    {date} · {paidCount}/{activeCharges.length} paid
  </p>
</div>
```

Where `scoutDisplay` is a derived constant inside the existing `.map((record) => ...)` body, alongside the existing `paidCount` / `outstandingTotal` / `showBilledSubtext`:

```ts
const scoutDisplay =
  record.is_void || activeCharges.length === 0
    ? null
    : activeCharges.length === 1
      ? `${activeCharges[0].scout_first_name} ${activeCharges[0].scout_last_name}`.trim()
      : 'Multiple Scouts'
```

### Mocks

Single-scout record (no payments yet):

```
☐  ▸  Summer Camp Deposit                    May 8   [Unpaid]   0/1   $50.00   [⋯]
        Alex Reed
```

Multi-scout record with a partial payment in it (matches the partial-payment fixture from the prior shipped work):

```
☐  ▸  Summer Camp Deposit                    May 8   [Partial]   1/4   $130.00   [⋯]
        Multiple Scouts                                                            of $200 billed
```

Fully-voided record:

```
☐  ▸  ̶S̶u̶m̶m̶e̶r̶ ̶C̶a̶m̶p̶ ̶D̶e̶p̶o̶s̶i̶t̶                  May 8   [Voided]   0/0   $0.00    [⋯]
```

(No scout subtext. Strikethrough already conveys the dead state.)

### Mobile behavior

On narrow screens the description column already shows a mobile-only secondary line for date + paid count. The new scout subtext renders at all breakpoints — so on mobile the description column gets two stacked subtext lines (scout name first, then date + count). The total vertical addition on mobile is one line. The `truncate` class on each subtext keeps long names or descriptions from overflowing.

## Data flow

### Query changes

None. `ChargeDetail` already includes `scout_first_name` and `scout_last_name` (added when partial-payment work landed).

### Type changes

None.

### Files touched

- `src/components/billing/billing-management-view.tsx` — add the derived `scoutDisplay` constant and the new subtext `<p>`. Single change to the existing row-rendering loop.
- `tests/unit/components/billing-management-view.test.tsx` — extend with three new test cases (single, multi, all-voided).

No new files. No helpers extracted (the logic is 4 lines and only one consumer).

## Testing strategy

### Component (RTL)

Four new test cases in `tests/unit/components/billing-management-view.test.tsx`, appended to the existing test file from the partial-payment shipping:

- **Single-scout record renders scout name as subtext.** Construct a record with one active charge, render, assert the scout's `${first_name} ${last_name}` appears under the description.
- **Multi-scout record renders "Multiple Scouts" subtext.** Reuse the existing `recordWithMixed` fixture (4 scouts, mixed paid/partial/unpaid). Assert "Multiple Scouts" text appears in the row.
- **`record.is_void = true` renders no scout subtext.** Construct a record with `is_void: true` and at least one active (non-voided) charge. Assert neither a scout name nor "Multiple Scouts" appears (defensive guard for the record-level predicate).
- **All charges voided renders no scout subtext.** Construct a record with `is_void: false` but every charge has `is_void: true`. Assert no subtext appears (defensive guard for the active-charges-length predicate).

The existing tests in this file already validate the rest of the row's behavior; the new tests only need to assert the new subtext.

### Manual (in dev)

After implementation, in dev:

1. `npm run db:fresh` to reset state.
2. Log in as treasurer, navigate to `/finances/billing`.
3. Create a single-scout billing record. Confirm the row shows the scout's `First Last` name under the description.
4. Create a multi-scout billing record (3+ scouts). Confirm the row shows "Multiple Scouts" under the description.
5. Void a multi-scout record (use any existing one with at least 2 active scouts). Confirm the subtext disappears entirely.
6. Resize to ~375px width and confirm the scout subtext stacks cleanly above the existing mobile-only `date · N/M paid` line, both with truncate.

## Risks

- **Long scout names overflowing.** Mitigated by the `truncate` class on the subtext `<p>` (matches the description's own truncation). A name longer than the column width gets ellipsized rather than wrapping.
- **Subtext crowding on mobile.** On narrow screens the description column will have two subtext lines. The total card-row height grows by one text line. This is acceptable — the previous shipped work also added a subtext (`of $X billed`) under the amount column, so users have already adjusted to row heights varying by content.
- **Future schema changes to `ChargeDetail`.** If `scout_first_name` / `scout_last_name` ever stop being included in the page-level query, the subtext silently falls through to whatever the coalesce defaults are. Low risk because the partial-payment work depends on these same fields.

## Open questions

None at the time of spec sign-off.
