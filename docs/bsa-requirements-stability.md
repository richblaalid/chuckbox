# BSA Requirements Data Stability Plan

## Current Problems

### Root Cause Analysis

The merit badge requirements data has recurring issues due to:

1. **Inconsistent Scraping Output**: The BSA website uses different HTML structures for different badges, resulting in inconsistent `requirement_number` formats:
   - `1a, 1b` (letters)
   - `1(a), 1(b)` (wrapped letters)
   - `Option A`, `Option B` (text)
   - `6A, 6B` (uppercase option letters)
   - `4Ac(2)` (mixed notation)

2. **No Canonical Transformation**: The seeder imports scraped data directly without normalizing formats.

3. **Badge-Specific Quirks**: Each badge with options has unique structural patterns that don't follow a common schema.

4. **Regression-Prone Workflow**: Every `db:fresh` can reintroduce issues if fix scripts aren't run.

### Affected Badges (34 versions with complex structures)

| Badge | Issue Type |
|-------|------------|
| Cycling | Option A/B nesting, numbered sub-requirements |
| Multisport | Option A/B/C/D patterns, _2/_3 suffixes |
| Animal Science | Named options (beef, avian, etc.) |
| Archery | Deep nesting (4+ levels) |
| Plant Science | Deep nesting (5 levels) |
| Skating | Named options (Ice, Inline) |
| Golf, Radio, etc. | Various Option patterns |

---

## Recommended Solution: Three-Tier Stability

### Tier 1: Canonical Data Normalization (Source Fix)

**Goal**: Fix the canonical JSON data once so the seeder produces correct structures.

**Implementation**:
1. Create `scripts/normalize-canonical-data.ts` that:
   - Transforms inconsistent requirement_numbers to standard format
   - Defines explicit rules for each problematic badge
   - Updates `data/bsa-data-canonical.json` with corrected structure

2. Standard requirement_number format:
   ```
   Top-level:     1, 2, 3, ...
   Sub-level:     1a, 1b, 1c, ... (lowercase letters)
   Sub-sub:       1a(1), 1a(2), ... (wrapped numbers)
   Sub-sub-sub:   1a(1)(a), 1a(1)(b), ... (wrapped letters)
   Options:       4A, 4B, 4C (uppercase single letter after number)
   Option subs:   4A(1), 4A(2), ... then 4A(1)(a), etc.
   ```

3. Explicit badge transformations:
   ```typescript
   const BADGE_TRANSFORMS: Record<string, TransformRule[]> = {
     'Cycling': [
       { from: /^6 Option ([AB])$/, to: '6$1' },
       { from: /^6 Option ([AB])\((\d+)\)$/, to: '6$1($2)' },
     ],
     'Multisport': [
       { from: /^4([ABCD])([abc])$/, to: '4$1(1)($2)' },
       { from: /^4([ABCD])([abc])_(\d+)$/, to: '4$1($3)($2)' },
     ],
     // ... other badges
   }
   ```

### Tier 2: Database-Level Validation (Safety Net)

**Goal**: Catch structural issues before they affect users.

**Implementation**:
1. Create `scripts/validate-bsa-structure.ts` that runs after seeding:
   ```typescript
   interface ValidationResult {
     badge: string
     version: number
     issues: {
       orphanedRequirements: string[]      // parent_id points to nothing
       headersWithoutChildren: string[]    // is_header but no children
       inconsistentNesting: string[]       // nesting_depth doesn't match parent chain
       duplicateNumbers: string[]          // same requirement_number in version
     }
   }
   ```

2. Add to `npm run db:fresh` pipeline:
   ```bash
   db:fresh = reset → seed:all → fix → validate → (fail if issues)
   ```

3. Validation SQL queries:
   ```sql
   -- Find orphaned requirements
   SELECT r.requirement_number
   FROM bsa_merit_badge_requirements r
   WHERE r.parent_requirement_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM bsa_merit_badge_requirements p
     WHERE p.id = r.parent_requirement_id
   );

   -- Find headers without children
   SELECT r.requirement_number
   FROM bsa_merit_badge_requirements r
   WHERE r.is_header = true
   AND NOT EXISTS (
     SELECT 1 FROM bsa_merit_badge_requirements c
     WHERE c.parent_requirement_id = r.id
   );
   ```

### Tier 3: Fix Script Registry (Recovery)

**Goal**: When issues occur, have documented fixes ready.

**Implementation**:
1. Registry file `data/requirement-fixes.json`:
   ```json
   {
     "fixes": [
       {
         "badge": "Cycling",
         "version": 2026,
         "script": "scripts/fix-cycling-2026-requirements.ts",
         "description": "Fix requirement 6 option nesting",
         "lastRun": "2026-02-11T..."
       }
     ]
   }
   ```

2. Master fix runner `scripts/fix-bsa-requirements.ts`:
   - Reads registry
   - Runs applicable fixes
   - Records results

3. Auto-discovery of needed fixes:
   - Validation failures → suggest applicable fix scripts

---

## Implementation Priority

### Phase 1: Immediate ✅ COMPLETE
- [x] Create `scripts/fix-bsa-requirements.ts` master runner
- [x] Integrate into `npm run db:fresh`
- [x] Create fix script for Multisport v2026

### Phase 2: Short-term ✅ COMPLETE
- [x] Create `scripts/validate-bsa-structure.ts`
- [x] Add validation to seed pipeline (`npm run db:fresh` → fix → validate)
- [x] Create `data/requirement-fixes.json` registry
- [x] Update fix runner to use registry and record results
- [x] Add validation-based fix suggestions

### Phase 3: Long-term (Future)
- [ ] Create `scripts/normalize-canonical-data.ts`
- [ ] Update canonical JSON with normalized data
- [ ] Remove need for runtime fix scripts

---

## Monitoring & Alerts

### Pre-Deploy Checklist
Before any deployment that touches BSA data:
1. Run `npm run db:fresh` on a test database
2. Run validation: `npx tsx scripts/validate-bsa-structure.ts`
3. Spot-check complex badges: Cycling, Multisport, Animal Science

### Regression Detection
After any scraping or seeding change:
1. Compare requirement counts per badge/version
2. Check header counts
3. Verify max nesting depth hasn't changed unexpectedly

---

## File Structure

```
scripts/
├── bsa-reference-data.ts             # Main seeder
├── fix-bsa-requirements.ts           # Master fix runner (reads from registry) ✅
├── validate-bsa-structure.ts         # Structure validation ✅
├── normalize-canonical-data.ts       # Canonical fix (TODO)
├── fix-cycling-2026-requirements.ts  # Cycling v2026 fix ✅
├── fix-multisport-2026-requirements.ts # Multisport v2026 fix ✅
├── fix-multisport-2025-requirements.ts # Multisport v2025 fix ✅
├── analyze-complex-badges.ts         # Analysis tool ✅
└── ...other fix scripts

data/
├── bsa-data-canonical.json           # Source data
├── requirement-fixes.json            # Fix registry ✅
├── validation-report.json            # Latest validation results ✅
└── hierarchy-fix-report.json         # Fix reports
```

---

## Success Criteria

1. **Zero Regressions**: `npm run db:fresh` produces consistent, correct data every time
2. **Fast Detection**: Structural issues caught within minutes, not days
3. **Easy Recovery**: Fix scripts resolve known issues in one command
4. **Self-Documenting**: Registry tracks what was fixed and when
