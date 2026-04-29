# Dark Mode (Campfire Mode) Completion Plan

## Current State

Dark mode infrastructure is **90% ready** but **functionality is disabled**:
- `forcedTheme="light"` in ThemeProvider forces light mode
- ThemeSettingsCard is commented out in settings page
- CSS variables fully defined in globals.css for light/dark
- ~40% of components have `dark:` class support

## Scope of Work

**17 components need dark mode fixes** before enabling:

### Critical (Unusable in dark mode)
| Component | File | Issues |
|-----------|------|--------|
| Button (ghost) | `src/components/ui/button.tsx` | Missing dark hover state |
| Progress | `src/components/ui/progress.tsx` | `bg-stone-100` no dark variant |
| MultiSelectDropdown | `src/components/ui/multi-select-dropdown.tsx` | Multiple hardcoded colors |
| CommandPalette | `src/components/ui/command-palette.tsx` | Search results missing dark |

### High Priority (Poor contrast)
| Component | File | Issues |
|-----------|------|--------|
| ToggleButtonGroup | `src/components/ui/toggle-button-group.tsx` | Container and inactive text |
| PaymentProcessingCard | `src/components/settings/payment-processing-card.tsx` | Collapsible triggers |
| PaymentModal | `src/components/accounts/payment-modal.tsx` | Close button |
| PaymentsTabs | `src/components/payments/payments-tabs.tsx` | Inactive tab text |

### Medium Priority (Minor contrast)
| Component | File | Issues |
|-----------|------|--------|
| AccountsList | `src/components/accounts/accounts-list.tsx` | Header button hover |
| AdultsList | `src/components/roster/adults-list.tsx` | Multiple hover states |
| ParentPaymentForm | `src/components/payments/parent-payment-form.tsx` | Account status text |
| SquareHistoryTab | `src/components/payments/square-history-tab.tsx` | Status text |
| ScoutbookSyncCard | `src/components/settings/scoutbook-sync-card.tsx` | Collapsible triggers |

## Color Mapping Reference

Standard mappings to apply:

| Light Mode | Dark Mode | Usage |
|------------|-----------|-------|
| `text-stone-900` | `dark:text-stone-100` | Primary text |
| `text-stone-700` | `dark:text-stone-200` | Secondary text |
| `text-stone-600` | `dark:text-stone-300` | Body text |
| `text-stone-500` | `dark:text-stone-400` | Muted text |
| `bg-white` | `dark:bg-stone-800` | Card backgrounds |
| `bg-stone-50` | `dark:bg-stone-800` | Subtle backgrounds |
| `bg-stone-100` | `dark:bg-stone-700` | Hover backgrounds |
| `border-stone-200` | `dark:border-stone-700` | Borders |
| `border-stone-300` | `dark:border-stone-600` | Input borders |
| `text-forest-600` | `dark:text-forest-400` | Links/accents |
| `hover:text-stone-700` | `dark:hover:text-stone-300` | Hover text |
| `hover:bg-stone-100` | `dark:hover:bg-stone-800` | Hover backgrounds |

## Implementation Steps

### Phase 1: Fix Critical Components
1. Fix `button.tsx` ghost variant
2. Fix `progress.tsx` background
3. Fix `multi-select-dropdown.tsx` (comprehensive)
4. Complete `command-palette.tsx` fixes

### Phase 2: Fix High Priority Components
5. Fix `toggle-button-group.tsx`
6. Fix `payment-processing-card.tsx`
7. Fix `payment-modal.tsx`
8. Fix `payments-tabs.tsx`

### Phase 3: Fix Medium Priority Components
9. Fix `accounts-list.tsx`
10. Fix `adults-list.tsx`
11. Fix `parent-payment-form.tsx`
12. Fix `square-history-tab.tsx`
13. Fix `scoutbook-sync-card.tsx`

### Phase 4: Enable Dark Mode
14. Remove `forcedTheme="light"` from ThemeProvider
15. Uncomment ThemeSettingsCard in settings page
16. Test all pages with Playwright screenshots

## Verification Plan

1. **Build verification**: `npm run build` must pass after each phase
2. **Visual testing with Playwright**:
   - Navigate to each major page (roster, billing, accounts, settings, payments)
   - Enable dark mode via `document.documentElement.classList.add('dark')`
   - Screenshot and verify text contrast
3. **Key pages to test**:
   - `/roster` - Tables with scout data
   - `/billing` - Scout selection cards
   - `/accounts` - Payment modals
   - `/settings` - Theme toggle, payment settings
   - `/payments` - Tabs and history

## Files to Modify

```
src/components/providers/theme-provider.tsx      # Enable dark mode
src/app/(dashboard)/settings/page.tsx            # Uncomment theme card
src/components/ui/button.tsx                     # Ghost variant
src/components/ui/progress.tsx                   # Background
src/components/ui/multi-select-dropdown.tsx      # Multiple fixes
src/components/ui/command-palette.tsx            # Search results
src/components/ui/toggle-button-group.tsx        # Container/text
src/components/settings/payment-processing-card.tsx
src/components/accounts/payment-modal.tsx
src/components/payments/payments-tabs.tsx
src/components/accounts/accounts-list.tsx
src/components/roster/adults-list.tsx
src/components/payments/parent-payment-form.tsx
src/components/payments/square-history-tab.tsx
src/components/settings/scoutbook-sync-card.tsx
```
