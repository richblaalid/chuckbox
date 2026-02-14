# Onboarding & Data Sync Improvements

## Overview

Comprehensive overhaul of unit onboarding and Scoutbook data synchronization to support multiple paths for getting started and ongoing data accuracy.

**Status**: Ready for Approval
**Created**: 2026-02-13
**Last Updated**: 2026-02-13

---

## Requirements

### User Value
- **Who**: Troop administrators setting up new units in Chuckbox
- **Problem**: Current onboarding requires a specific CSV file; no manual path exists. Ongoing sync is limited to roster data only.
- **Goal**: Flexible onboarding (CSV, manual, or extension) with comprehensive data sync

### Scope

**In Scope:**
1. Flexible onboarding paths (CSV import, manual entry, extension sync)
2. Editable unit metadata during signup (unit number, suffix, council, district)
3. Fix council name parsing bug (duplicate text issue)
4. Roster preview before import
5. Manual trigger sync via extension
6. Additive-only sync strategy (don't remove existing data)
7. Softer duplicate unit warnings

**Out of Scope (Future):**
- Automated/scheduled sync
- Mobile sync support
- Offline capability
- Direct write to Scoutbook (not feasible without official API)

### Success Criteria
1. User can create a unit without any CSV file
2. User can edit detected unit info before confirming
3. Council names parse correctly (no duplicate text)
4. Roster preview shows scouts/patrols before import
5. Extension sync is additive-only (never removes data)
6. Duplicate unit check is scoped to council (not global)
7. Linked troops work (parent "Troop 297" contains sections "9297B" and "7297G")
8. Requirement-level advancement syncs from Scoutbook
9. Export generates Scoutbook-compatible CSV for manual upload

### Technical Constraints
- Must maintain backward compatibility with existing units
- Extension sync uses existing HTML parsing infrastructure
- Conflict resolution defaults to "Chuckbox wins"

---

## Technical Design

### Architecture Overview

**Hybrid Two-Stage Onboarding:**
- **Stage 1 (Signup)**: Optional CSV upload OR "Skip for Now" to create empty unit
- **Stage 2 (First Login)**: Setup wizard guides through roster import/entry if not done during signup

```
┌─────────────────────────────────────────────────────────────┐
│              STAGE 1: SIGNUP (Pre-Authentication)            │
├─────────────────────────────────────────────────────────────┤
│   User Choice at Signup:                                     │
│   ┌─────────────────────┐  ┌─────────────────────────────┐  │
│   │   Upload CSV Now    │  │   Skip for Now              │  │
│   │   - Parse roster    │  │   - Create empty unit       │  │
│   │   - Edit unit info  │  │   - Enter basic unit info   │  │
│   │   - Preview roster  │  │   - Skip roster import      │  │
│   └─────────────────────┘  └─────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│              STAGE 2: FIRST LOGIN (Post-Authentication)      │
├─────────────────────────────────────────────────────────────┤
│   If skipped CSV at signup, Setup Wizard offers:             │
│   ┌─────────────────┬──────────────────┬───────────────────┐│
│   │  Upload CSV     │  Manual Entry    │  Connect Extension ││
│   │  (same flow)    │  (add scouts)    │  (install + sync) ││
│   └─────────────────┴──────────────────┴───────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                    ONGOING DATA SYNC                         │
├─────────────────────────────────────────────────────────────┤
│   Extension Sync (Read-Only from Scoutbook):                 │
│   - Roster updates                                           │
│   - Rank requirement completions                             │
│   - Merit badge requirement completions                      │
│   - Additive-only (never removes data)                       │
├─────────────────────────────────────────────────────────────┤
│                    DATA EXPORT (For Scoutbook)               │
│   - Roster CSV export                                        │
│   - Advancement CSV export                                   │
│   - Manual upload to Scoutbook                               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
SCOUTBOOK ──────────────────────────────────────── CHUCKBOX
    │                                                  │
    │  [Extension Sync - Read Only]                    │
    │  ─────────────────────────────────────────────►  │
    │  • Roster data                                   │
    │  • Rank requirements                             │
    │  • Merit badge requirements                      │
    │                                                  │
    │  [CSV Export - Manual Upload]                    │
    │  ◄─────────────────────────────────────────────  │
    │  • Roster changes                                │
    │  • Advancement completions                       │
    │                                                  │
    └──────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Hybrid Two-Stage Onboarding**: CSV optional at signup; manual entry and extension sync available post-login
   - Reduces signup friction for users without CSV ready
   - Enables auth-dependent features (extension tokens) after first login
   - Preserves fast path for users with CSV ready
2. **Editable Metadata**: Form fields pre-populated from CSV (if provided), always editable
3. **Council Normalization**: Clean duplicates, remove trailing numbers, trim whitespace
4. **Duplicate Unit Check**: Warn but allow proceed with confirmation (scoped to council)
5. **Additive Sync**: New records added, existing records updated (never deleted), completed requirements never unmarked
6. **Linked Troops**: User defines parent unit name; sections detected from CSV or entered manually

### Database Changes

No new tables required. Updates to existing:

```sql
-- Track if unit needs post-login setup
ALTER TABLE units ADD COLUMN IF NOT EXISTS needs_setup BOOLEAN DEFAULT false;

-- Add sync strategy column (for future flexibility)
ALTER TABLE units ADD COLUMN IF NOT EXISTS sync_strategy TEXT DEFAULT 'additive';
-- Values: 'additive' (default), 'overwrite' (future)
```

---

## Implementation Tasks

### Phase 0: Foundation & Bug Fixes

#### 0.1 Parser Improvements
- [x] **0.1.1** Fix roster parser to stop at DEN CHIEF section *(completed)*
- [x] **0.1.2** Fix importer to not overwrite patrol_id with null *(completed)*
- [x] **0.1.3** Fix council name parsing (remove duplicate text, trailing numbers) *(completed)*
- [x] **0.1.4** Fix district name parsing (same issue) *(completed)*
- [x] **0.1.5** Add unit tests for parser edge cases *(completed)*

#### 0.2 Duplicate Unit Check Improvements
- [x] **0.2.1** Normalize council names before comparison (lowercase, trim, dedupe) *(completed)*
- [x] **0.2.2** Change from hard block to soft warning with confirmation option *(completed)*
- [x] **0.2.3** Show existing unit details in warning message *(completed)*

### Phase 1: Hybrid Onboarding UI

#### 1.1 Signup Flow Updates (Stage 1)
- [x] **1.1.1** Add "Skip for Now" option to CSV upload step *(completed)*
- [x] **1.1.2** Create manual unit metadata form (for skip path) *(completed)*
- [x] **1.1.3** Mark unit as `needs_setup: true` when skipping CSV *(completed)*
- [ ] **1.1.4** Persist signup path choice for analytics

#### 1.2 Editable Unit Metadata
- [ ] **1.2.1** Convert Step 1 display to editable form fields
- [ ] **1.2.2** Pre-populate from CSV parse (if CSV path)
- [ ] **1.2.3** Add validation for required fields (unit type, number)
- [ ] **1.2.4** Add council autocomplete/suggestions (optional enhancement)
- [ ] **1.2.5** Update provisionUnit to accept user-edited metadata

#### 1.3 Roster Preview
- [ ] **1.3.1** Create RosterPreview component
- [ ] **1.3.2** Show scouts grouped by patrol
- [ ] **1.3.3** Show adults grouped by role
- [ ] **1.3.4** Display parse warnings/errors
- [ ] **1.3.5** Allow deselecting individual members before import

### Phase 2: Post-Login Setup Wizard (Stage 2)

#### 2.1 Setup Wizard Framework
- [ ] **2.1.1** Create SetupWizard component (shown when `needs_setup: true`)
- [ ] **2.1.2** Add setup wizard route at `/setup` (protected, redirect if setup complete)
- [ ] **2.1.3** Show path selection: CSV Upload / Manual Entry / Connect Extension
- [ ] **2.1.4** Track completion status in unit record

#### 2.2 CSV Upload Path (Post-Login)
- [ ] **2.2.1** Reuse existing CSV upload/preview components
- [ ] **2.2.2** Mark `needs_setup: false` after successful import
- [ ] **2.2.3** Redirect to dashboard on completion

#### 2.3 Manual Entry Path
- [ ] **2.3.1** Create AddScoutForm component
- [ ] **2.3.2** Create AddPatrolForm component
- [ ] **2.3.3** Support BSA member ID entry (optional)
- [ ] **2.3.4** Guardian linking UI
- [ ] **2.3.5** Allow completing setup with empty roster ("I'll add scouts later")

#### 2.4 Extension Connection Path
- [ ] **2.4.1** Create extension install instructions component
- [ ] **2.4.2** Generate auth token for extension after login
- [ ] **2.4.3** Show "Waiting for extension connection" status
- [ ] **2.4.4** Auto-detect when extension connects
- [ ] **2.4.5** Trigger initial sync and show preview
- [ ] **2.4.6** Mark `needs_setup: false` after successful sync

### Phase 3: Sync Strategy Improvements

#### 3.1 Additive-Only Sync
- [ ] **3.1.1** Update confirmStagedImport to never delete existing records
- [ ] **3.1.2** Add "preserve" flag for completed requirements
- [ ] **3.1.3** Only update fields if new value is "better" (non-null, more recent)
- [ ] **3.1.4** Log skipped updates for audit trail

#### 3.2 Extension Sync Enhancements
- [ ] **3.2.1** Add sync trigger button to settings page
- [ ] **3.2.2** Show last sync timestamp and summary
- [ ] **3.2.3** Display sync history (last 10 syncs)
- [ ] **3.2.4** Add sync-in-progress indicator

#### 3.3 Conflict Resolution
- [ ] **3.3.1** Define conflict detection criteria
- [ ] **3.3.2** Create conflict review UI
- [ ] **3.3.3** Default to Chuckbox wins, show Scoutbook value for reference
- [ ] **3.3.4** Allow per-field override to Scoutbook value

### Phase 4: Linked Troops Support

#### 4.1 Database Schema for Sections
- [ ] **4.1.1** Add `parent_unit_id` foreign key to units table (already exists)
- [ ] **4.1.2** Add `is_section` boolean to units table (already exists)
- [ ] **4.1.3** Add `section_identifier` field (e.g., "9297B", "7297G")
- [ ] **4.1.4** Create migration for section support enhancements

#### 4.2 Linked Troop Onboarding
- [ ] **4.2.1** Detect multiple troops in CSV (e.g., "Troop 7297 G | Troop 9297 B")
- [ ] **4.2.2** Prompt user to define parent unit name (e.g., "Troop 297")
- [ ] **4.2.3** Create parent unit + section units
- [ ] **4.2.4** Assign scouts to correct section based on CSV data

#### 4.3 Section Management UI
- [ ] **4.3.1** Show sections in unit settings
- [ ] **4.3.2** Allow switching between section views
- [ ] **4.3.3** Aggregate view for parent unit (all scouts)

### Phase 5: Advancement Sync (Requirement-Level)

#### 5.1 Advancement Data Extraction
- [ ] **5.1.1** Parse rank requirements from Scoutbook HTML
- [ ] **5.1.2** Parse merit badge requirements from Scoutbook HTML
- [ ] **5.1.3** Map Scoutbook requirement IDs to Chuckbox IDs
- [ ] **5.1.4** Handle version year differences

#### 5.2 Advancement Staging
- [ ] **5.2.1** Use existing `sync_staged_advancement` table
- [ ] **5.2.2** Stage rank requirement completions
- [ ] **5.2.3** Stage merit badge requirement completions
- [ ] **5.2.4** Detect conflicts (completed in Scoutbook but not Chuckbox)

#### 5.3 Additive Import
- [ ] **5.3.1** Import only NEW completions (never un-complete)
- [ ] **5.3.2** Preserve Chuckbox completion dates if earlier
- [ ] **5.3.3** Track source of completion (Scoutbook vs Chuckbox)
- [ ] **5.3.4** Show sync summary with counts

### Phase 6: Export to Scoutbook

#### 6.1 Export Format Research
- [ ] **6.1.1** Research Scoutbook import formats (if any exist)
- [ ] **6.1.2** Document TroopTrack/other tool export formats
- [ ] **6.1.3** Define Chuckbox export schema

#### 6.2 Roster Export
- [ ] **6.2.1** Export scouts CSV (name, BSA ID, rank, patrol, positions)
- [ ] **6.2.2** Export adults CSV (name, BSA ID, positions)
- [ ] **6.2.3** Add export button to roster page

#### 6.3 Advancement Export
- [ ] **6.3.1** Export rank progress CSV per scout
- [ ] **6.3.2** Export merit badge progress CSV per scout
- [ ] **6.3.3** Export bulk advancement report
- [ ] **6.3.4** Add export button to advancement pages

### Phase 7: Quality & Polish

#### 7.1 Error Handling
- [ ] **7.1.1** Improve error messages for common failures
- [ ] **7.1.2** Add retry logic for transient failures
- [ ] **7.1.3** Create troubleshooting guide in UI

#### 7.2 Testing
- [ ] **7.2.1** Unit tests for parser improvements
- [ ] **7.2.2** Integration tests for each onboarding path
- [ ] **7.2.3** E2E test for full signup flow
- [ ] **7.2.4** Test linked troop scenarios
- [ ] **7.2.5** Test advancement sync edge cases

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/app/(dashboard)/setup/page.tsx` | Post-login setup wizard route |
| `src/components/setup/setup-wizard.tsx` | Post-login setup wizard (3 paths) |
| `src/components/setup/path-selector.tsx` | CSV / Manual / Extension selection |
| `src/components/setup/extension-connect.tsx` | Extension install + connect flow |
| `src/components/onboarding/unit-metadata-form.tsx` | Editable unit info form |
| `src/components/onboarding/roster-preview.tsx` | Preview scouts/adults before import |
| `src/components/onboarding/linked-troop-setup.tsx` | Configure parent unit + sections |
| `src/components/roster/add-scout-form.tsx` | Manual scout entry form |
| `src/components/roster/add-patrol-form.tsx` | Manual patrol creation form |
| `src/app/actions/manual-unit-creation.ts` | Server action for no-CSV signup |
| `src/app/actions/export-for-scoutbook.ts` | Generate Scoutbook-compatible CSVs |
| `src/lib/sync/scoutbook/advancement-parser.ts` | Parse rank/badge requirements from HTML |
| `src/lib/export/scoutbook-csv.ts` | CSV generation utilities |
| `tests/unit/lib/bsa-roster-parser.test.ts` | Parser unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/import/bsa-roster-parser.ts` | Council/district parsing fixes, multi-troop detection |
| `src/components/onboarding/signup-wizard.tsx` | Add "Skip for Now" option, editable metadata |
| `src/components/setup/setup-wizard.tsx` | New: Post-login setup wizard (3 paths) |
| `src/app/actions/onboarding.ts` | Accept edited metadata, soft duplicate check, sections |
| `src/lib/sync/scoutbook/import.ts` | Additive-only sync logic, advancement staging |
| `src/lib/sync/scoutbook/ai-parser.ts` | Add advancement data extraction |
| `src/app/api/scoutbook/sync/confirm/route.ts` | Preserve existing data, handle advancement |
| `supabase/migrations/XXXXXX_section_support.sql` | Section identifier column |

---

## Testing Strategy

### Unit Tests
- Parser edge cases (duplicate council names, missing fields)
- Metadata normalization functions
- Conflict detection logic

### Integration Tests
- CSV upload → preview → import flow
- Manual entry → empty unit → add scout flow
- Extension sync → staging → confirm flow

### E2E Tests
- Full signup with CSV
- Full signup without CSV (manual)
- Sync via extension after unit created

---

## Rollout Plan

### Release 1: Foundation & Hybrid Onboarding (Phases 0-2)
- Bug fixes (parser, council names, duplicate check)
- "Skip for Now" option at signup
- Editable unit metadata
- Post-login setup wizard with 3 paths
- **Ship as improvement to existing flow**

### Release 2: Linked Troops (Phase 4)
- Section support (parent + section units)
- Multi-troop CSV detection
- Section management UI
- **Ship after Release 1 validated**

### Release 3: Sync Improvements (Phases 3, 5)
- Additive-only roster sync
- Requirement-level advancement sync (ranks + merit badges)
- Sync history UI
- **Requires extension update**

### Release 4: Export & Polish (Phases 6-7)
- Scoutbook-compatible CSV export
- Error handling improvements
- Comprehensive testing
- **Final production release**

---

## Task Log

| Date | Task | Commit |
|------|------|--------|
| 2026-02-13 | 0.1.1 Fix parser DEN CHIEF section | e992280 |
| 2026-02-13 | 0.1.2 Fix patrol_id overwrite | e992280 |
| 2026-02-13 | 0.1.3 Fix council name parsing | 6c3985e |
| 2026-02-13 | 0.1.4 Fix district name parsing | 4c94704 |
| 2026-02-13 | 0.1.5 Add edge case tests | cd02ce6 |
| 2026-02-13 | 0.2.1 Normalize council for comparison | 4fdd01c |
| 2026-02-13 | 0.2.2 Soft warning for duplicate units | 679cff8 |
| 2026-02-13 | 0.2.3 Show existing unit details in warning | e4c701b |
| | | |

---

## Open Questions

1. ~~**Council List**: Should we provide a dropdown of known BSA councils, or always allow free-text entry?~~ **RESOLVED**: Free text for now
2. **Extension Update**: Will advancement sync require a new extension version? (Likely yes - need to capture more HTML)
3. ~~**Advancement Sync**: Should we include basic rank/badge sync in this phase or defer?~~ **RESOLVED**: Include requirement-level sync
4. ~~**Multi-troop Units**: How should we handle CSVs with multiple troops (like 7297G + 9297B)?~~ **RESOLVED**: Linked troops - parent unit (297) with sections (9297B, 7297G)
5. **Scoutbook Import Format**: Does Scoutbook accept any CSV imports? Need to research what formats work.
6. **Section Switching**: How should UI handle switching between section views vs aggregate view?
7. ~~**Onboarding Timing**: CSV during signup vs after sign-in?~~ **RESOLVED**: Hybrid - CSV optional at signup, full setup wizard post-login

---

## Appendix: Current Gaps Identified

From codebase exploration:

1. **Gap 1**: No manual unit creation path exists
2. **Gap 2**: Unit metadata not editable during signup
3. **Gap 3**: Council parsing produces duplicate text ("Northern Star Council 250Northern Star Council 250")
4. **Gap 4**: No roster preview before import
5. **Gap 5**: Duplicate check blocks instead of warns
6. **Gap 6**: Extension sync can overwrite Chuckbox data
7. **Gap 7**: No sync history visible to users
8. **Gap 8**: DEN CHIEF section causes duplicate scouts *(fixed)*
9. **Gap 9**: Null patrol overwrites valid patrol *(fixed)*
