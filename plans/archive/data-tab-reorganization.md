# Data Tab Reorganization Plan

## Problem Statement

The Settings > Data tab currently has **two cards** with overlapping functionality:

1. **Scoutbook Plus Card** - Contains:
   - Browser Automation (CLI-based sync)
   - Browser Extension (token-based sync)
   - CSV Upload → links to `/settings/import` (roster import)

2. **Import Data Card** - Contains:
   - Import Roster → links to `/settings/import` (same as above!)
   - Import Advancement History → `/settings/import/advancement`
   - Import Troop Advancement → `/settings/import/troop-advancement`

**Issues:**
- "CSV Upload" and "Import Roster" both link to the same roster import page
- Users may be confused about which option to use
- The separation creates an artificial distinction between "Scoutbook" and "other imports" when all advancement data comes from Scoutbook anyway

---

## Proposed Solution: Unified Scoutbook Section

Consolidate all import functionality under a single **"Scoutbook Data Import"** card with three sections:

### New Card Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Scoutbook Data Import                                       │
│  Import roster and advancement data from Scoutbook          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ── ROSTER SYNC ──────────────────────────────────────────  │
│                                                              │
│  Choose how to sync your unit roster:                        │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ 🧩 Browser       │  │ 📁 CSV Upload    │                 │
│  │    Extension     │  │                  │                 │
│  │                  │  │ Export from      │                 │
│  │ Sync while you   │  │ my.scouting.org  │                 │
│  │ browse Scoutbook │  │ and upload here  │                 │
│  │                  │  │                  │                 │
│  │ [Generate Token] │  │ [Upload CSV →]   │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ── ADVANCEMENT IMPORT ───────────────────────────────────  │
│                                                              │
│  Import advancement history from Scoutbook exports:          │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ 👤 Single Scout  │  │ 👥 Entire Unit   │                 │
│  │                  │  │                  │                 │
│  │ Import one       │  │ Bulk import for  │                 │
│  │ scout's full     │  │ all scouts at    │                 │
│  │ advancement      │  │ once             │                 │
│  │ history          │  │                  │                 │
│  │                  │  │                  │                 │
│  │ [Import →]       │  │ [Import →]       │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ── ADVANCED ─────────────────────────────────────────────  │
│  (DEV ONLY - hidden in production via feature flag)          │
│                                                              │
│  🖥️ Browser Automation                                      │
│  Install CLI tools for automated syncing                     │
│  [Setup →]                                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Section Breakdown

#### 1. Roster Sync (Primary)
Two equal options for getting roster data:

| Option | Description | Target User |
|--------|-------------|-------------|
| **Browser Extension** | Token-based sync while browsing Scoutbook | Most users |
| **CSV Upload** | Manual export/upload workflow | Users who prefer manual process |

#### 2. Advancement Import
Two options based on scope:

| Option | Description | Use Case |
|--------|-------------|----------|
| **Single Scout** | Import one scout's advancement history | New transfers, individual fixes |
| **Entire Unit** | Bulk import all scouts' advancement | Initial setup, periodic sync |

#### 3. Advanced (Dev Only)
The CLI-based browser automation option is only visible in development environments. Hidden in production via feature flag since most users will use the extension or CSV.

---

## Implementation Tasks

### Phase 0: Add Feature Flag

#### 0.1 Add CLI_AUTOMATION feature flag
- [x] Add `CLI_AUTOMATION` to `FeatureFlag` enum in `src/lib/feature-flags.ts`
- [x] Configure with `NEXT_PUBLIC_FEATURE_CLI_AUTOMATION` env var
- [x] Default to `false` (hidden in prod, only enabled locally via `.env.local`)

### Phase 1: Restructure Data Tab UI

#### 1.1 Restructure ScoutbookSyncCard with unified layout
- [x] Add section headers for "Roster Sync" and "Advancement Import"
- [x] Include RosterSyncSection with Extension + CSV options
- [x] Include AdvancementImportSection with Single Scout + Unit options
- [x] Conditionally render CLI section based on feature flag

#### 1.2 Update settings page
- [x] Remove the separate "Import Data" card from settings page
- [x] Clean up unused imports (FileSpreadsheet, Award, Users, Link, Button)

#### 1.3 Implement responsive grid layout
- [x] 2-column grid for import option cards (md:grid-cols-2)
- [x] Stack to single column on mobile (grid-cols-1)
- [x] Consistent card styling across all options

### Phase 2: Polish & Edge Cases

#### 2.1 Handle staging state
- [x] When staging data exists, show staging review UI (existing behavior preserved)
- [x] Hide import options while reviewing staged data (!hasStaging checks)

#### 2.2 Role-based visibility
- [x] Extension token generation: admin only (isAdmin check)
- [x] CLI automation: dev-only via `FeatureFlag.CLI_AUTOMATION`
- [x] Advancement imports: visible to all roles with settings access

#### 2.3 Clean up
- [x] Removed duplicate Import Data card from settings page
- [x] ScoutbookSyncCard now contains all import functionality

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/(dashboard)/settings/page.tsx` | Remove Import Data card, simplify Data tab content |
| `src/components/settings/scoutbook-sync-card.tsx` | Major restructure to unified layout |
| (new) `src/components/settings/data-import-card.tsx` | Optional: Extract to new component if too large |

---

## Decisions

1. **CLI Browser Automation** - Only visible in development via feature flag. Hidden in production.
2. **Layout** - Single unified card with sections for Roster Sync and Advancement Import.

---

## Success Criteria

- [x] No duplicate import options visible to users
- [x] Clear distinction between roster sync and advancement import
- [x] Browser extension remains the prominent/recommended option
- [x] CSV upload easily accessible for users who need it
- [x] All existing import functionality preserved
- [x] Mobile-responsive layout

---

## Task Log

| Date | Task | Commit |
|------|------|--------|
| 2026-02-06 | All phases complete | pending |
