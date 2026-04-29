# Merit Badge Seed File Rebuild

> **Status:** Planning
> **Created:** 2026-01-27
> **Author:** Claude

---

## 1. Requirements

### 1.1 Problem Statement
The current `bsa-data-canonical.json` has inaccurate hierarchy and inconsistent requirement IDs. We need a new, accurate seed file that:
- Uses exact Scoutbook requirement IDs from the Achievement CSV
- Captures accurate parent-child hierarchy from Scoutbook UI (up to 4 levels deep)
- Identifies headers (non-completable items) by comparing CSV to UI
- Extracts embedded links for display in ChuckBox
- Flags discrepancies for manual review

### 1.2 Success Criteria
- [ ] 100% match between seed file requirement IDs and Scoutbook Achievement CSV
- [ ] All headers identified and included with descriptions
- [ ] Parent-child relationships match visual nesting in Scoutbook UI
- [ ] All embedded links captured with type classification
- [ ] Discrepancy report generated for manual review
- [ ] Output replaces `bsa-data-canonical.json` as single source of truth

### 1.3 Decisions

| Question | Answer |
|----------|--------|
| Hierarchy detection | Capture from UI visual nesting (not pattern matching) |
| Discrepancy handling | Flag for manual review |
| Link types | Capture all external links |
| Output format | Replace current canonical file |
| Auth method | Manual login + session persistence |
| Discontinued badges | Identify and prompt for manual data |
| Runtime | Full overnight run acceptable |
| Version inheritance | None - each badge+version is unique |

---

## 2. Technical Design

### 2.1 Three-Phase Approach

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: Load CSV Requirement IDs                              │
│  ─────────────────────────────────────────────────────────────  │
│  Input: Scoutbook Achievement CSV export                        │
│  Output: Map<badgeName:versionYear, Set<requirementId>>         │
│                                                                 │
│  • Parse CSV for merit badge requirements only                  │
│  • Group by badge name and version year                         │
│  • Store exact requirement IDs as authoritative                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: Scrape UI with Playwright                             │
│  ─────────────────────────────────────────────────────────────  │
│  Input: Scoutbook Merit Badges UI (manual login)                │
│  Output: Raw scraped data with visual hierarchy                 │
│                                                                 │
│  For each badge + version:                                      │
│  • Capture ALL visible items (headers + requirements)           │
│  • Record visual nesting depth (0-4 levels)                     │
│  • Extract description text                                     │
│  • Extract all <a> href links with surrounding context          │
│  • Record display label exactly as shown                        │
│  • Note if item has checkbox (completable) or not (header)      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: Merge & Validate                                      │
│  ─────────────────────────────────────────────────────────────  │
│  Input: CSV IDs + Scraped UI data                               │
│  Output: bsa-data-canonical.json + discrepancy-report.json      │
│                                                                 │
│  For each scraped item:                                         │
│  • Match to CSV ID → requirement (completable)                  │
│  • No CSV match → header (non-completable)                      │
│  • Build parent_id from visual nesting                          │
│  • Attach extracted links                                       │
│                                                                 │
│  Flag discrepancies:                                            │
│  • CSV ID not found in UI                                       │
│  • Ambiguous matches                                            │
│  • Badge/version in CSV but not accessible in UI                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Structures

**Phase 1 Output: CSV Requirement Map**
```typescript
interface CsvRequirement {
  scoutbookId: string        // Exact ID from CSV: "1a", "4a1 Triathlon Option"
  badgeName: string          // "Camping", "Multisport"
  versionYear: number        // 2025, 2026
}

type CsvRequirementMap = Map<string, CsvRequirement[]>  // key: "Camping:2025"
```

**Phase 2 Output: Scraped UI Data**
```typescript
interface ScrapedItem {
  displayLabel: string       // "(a)", "(1)", "4", "" (empty for headers)
  description: string        // Full requirement/header text
  visualDepth: number        // 0 = root, 1-4 = nested levels
  hasCheckbox: boolean       // true = completable, false = header
  links: ScrapedLink[]       // All extracted links
  parentIndex: number | null // Index of parent item in same badge/version
  rawHtml?: string           // For debugging complex cases
}

interface ScrapedLink {
  url: string                // Full href
  text: string               // Link text
  context: string            // Surrounding text (for display)
  type: 'pamphlet' | 'worksheet' | 'video' | 'external'  // Inferred type
}

interface ScrapedBadgeVersion {
  badgeName: string
  versionYear: number
  versionLabel: string       // "Current requirements - 2025"
  items: ScrapedItem[]
  scrapedAt: string
}
```

**Phase 3 Output: Canonical Format**
```typescript
interface CanonicalRequirement {
  scoutbook_id: string       // From CSV (authoritative)
  requirement_number: string // Display number
  description: string        // From UI
  is_header: boolean         // true if no CSV match
  display_order: number
  parent_scoutbook_id: string | null  // Built from visual nesting
  links: RequirementLink[]
  children: CanonicalRequirement[]
}

interface RequirementLink {
  url: string
  text: string
  type: 'pamphlet' | 'worksheet' | 'video' | 'external'
}

interface CanonicalVersion {
  version_year: number
  requirements: CanonicalRequirement[]
}

interface CanonicalBadge {
  code: string
  name: string
  category: string | null
  is_eagle_required: boolean
  is_active: boolean
  versions: CanonicalVersion[]
}
```

**Discrepancy Report**
```typescript
interface Discrepancy {
  type: 'csv_not_in_ui' | 'ui_not_matched' | 'badge_not_accessible' | 'ambiguous_match'
  badgeName: string
  versionYear: number
  scoutbookId?: string
  uiLabel?: string
  description: string
  suggestedAction: string
}
```

### 2.3 Link Type Detection

```typescript
function classifyLink(url: string, text: string): LinkType {
  const lowerUrl = url.toLowerCase()
  const lowerText = text.toLowerCase()

  if (lowerUrl.includes('pamphlet') || lowerText.includes('pamphlet')) {
    return 'pamphlet'
  }
  if (lowerUrl.includes('worksheet') || lowerText.includes('worksheet')) {
    return 'worksheet'
  }
  if (lowerUrl.includes('youtube') || lowerUrl.includes('video') || lowerText.includes('video')) {
    return 'video'
  }
  return 'external'
}
```

### 2.4 Visual Depth Detection

The key insight is that Scoutbook's Ant Design UI uses consistent CSS classes for nesting:

```typescript
// In page.evaluate():
function getVisualDepth(element: Element): number {
  // Count parent containers with specific classes
  let depth = 0
  let current = element.parentElement

  while (current) {
    if (current.matches('[class*="ant-collapse-content"]')) {
      depth++
    }
    if (current.matches('[class*="requirementItemContainer"]')) {
      depth++
    }
    current = current.parentElement
  }

  return Math.min(depth, 4)  // Cap at 4 levels
}
```

---

## 3. Implementation Tasks

### Phase 0: Setup & CSV Parsing

#### 0.1 CSV Parser
- [ ] **0.1.1** Create CSV parser for Scoutbook Achievement export
  - File: `scripts/parse-achievement-csv.ts`
  - Extract: badge name, version year, requirement ID
  - Output: `data/csv-requirement-ids.json`

- [ ] **0.1.2** Validate CSV parser against known badges
  - Test with Camping, Multisport, Cooking (complex hierarchies)
  - Verify all requirement IDs extracted correctly

### Phase 0.5: Test Badge Validation

#### 0.2 Single Badge Test Script
- [ ] **0.2.1** Create single-badge test script
  - File: `scripts/test-single-badge-scrape.ts`
  - Takes badge name as argument
  - Outputs detailed results for inspection
  - Includes expected vs actual comparison

- [ ] **0.2.2** Define expected results for test badges
  - File: `data/test-badge-expectations.json`
  - Define expected hierarchy for 3 test badges
  - Include expected headers, depths, parent-child relationships

#### 0.3 Test Badge: Simple (First Aid)
- [ ] **0.3.1** Run scraper on First Aid only
- [ ] **0.3.2** Verify 2-level hierarchy captured correctly
- [ ] **0.3.3** Verify headers identified (items without CSV match)
- [ ] **0.3.4** Verify links extracted if present
- [ ] **0.3.5** Compare output to expected results

#### 0.4 Test Badge: Complex Brackets (Environmental Science)
- [ ] **0.4.1** Run scraper on Environmental Science only
- [ ] **0.4.2** Verify bracket notation requirements captured: `3a[1]`, `3a[2]`, etc.
- [ ] **0.4.3** Verify 3-level hierarchy: 3 → 3a → 3a[1]
- [ ] **0.4.4** Verify headers for "Do TWO of the following" type text
- [ ] **0.4.5** Compare output to expected results

#### 0.5 Test Badge: Deep Nesting (Multisport)
- [ ] **0.5.1** Run scraper on Multisport only
- [ ] **0.5.2** Verify 4-level hierarchy: 4 → Triathlon Option → (a) → (1)
- [ ] **0.5.3** Verify all 4 sport options captured as separate headers
- [ ] **0.5.4** Verify option-specific requirements nested correctly
- [ ] **0.5.5** Compare output to expected results

#### 0.6 Validation Gate
- [ ] **0.6.1** All 3 test badges produce expected output
- [ ] **0.6.2** No discrepancies flagged that shouldn't be
- [ ] **0.6.3** User approves test results before full run

### Phase 1: UI Scraper Updates

#### 1.1 Enhanced Scraping
- [ ] **1.1.1** Update scraper to capture visual depth from DOM
  - File: `scripts/scrape-all-merit-badges.ts`
  - Count nesting levels from CSS structure
  - Record parent-child relationships by position

- [ ] **1.1.2** Add checkbox detection for header identification
  - Detect presence of checkbox/completable indicator
  - Mark items without checkbox as potential headers

- [ ] **1.1.3** Add link extraction
  - Find all `<a>` tags within requirement content
  - Extract href, text, and surrounding context
  - Classify link type

- [ ] **1.1.4** Capture raw HTML for complex cases
  - Store innerHTML for items with unusual structure
  - Enable debugging of edge cases

#### 1.2 Session Management
- [ ] **1.2.1** Add session persistence
  - Save cookies/localStorage after manual login
  - Load saved session for subsequent runs
  - Detect session expiry and prompt for re-login

### Phase 2: Merge Logic

#### 2.1 Matching Algorithm
- [ ] **2.1.1** Create merge script
  - File: `scripts/merge-csv-with-ui.ts`
  - Load CSV requirement IDs
  - Load scraped UI data
  - Match by requirement ID where possible

- [ ] **2.1.2** Implement header identification
  - Items in UI without CSV match = headers
  - Preserve header descriptions and links

- [ ] **2.1.3** Build parent-child relationships
  - Use visual depth to determine hierarchy
  - Assign parent_scoutbook_id based on nesting

#### 2.2 Discrepancy Detection
- [ ] **2.2.1** Flag CSV IDs not found in UI
  - May indicate discontinued requirements
  - Or UI navigation issues

- [ ] **2.2.2** Flag ambiguous matches
  - Multiple UI items could match one CSV ID
  - Requires manual resolution

- [ ] **2.2.3** Generate discrepancy report
  - File: `data/discrepancy-report.json`
  - Human-readable format with suggested actions

### Phase 3: Output Generation

#### 3.1 Canonical File
- [ ] **3.1.1** Generate new bsa-data-canonical.json
  - Full hierarchical structure
  - All headers included
  - All links attached

- [ ] **3.1.2** Validate output format
  - Matches expected schema
  - Can be imported by existing import script

#### 3.2 Manual Review
- [ ] **3.2.1** Review discrepancy report
  - Resolve each flagged item
  - Add missing data manually where needed

- [ ] **3.2.2** Verify complex badges
  - Multisport, Archery, Skating (known complex hierarchies)
  - Confirm 4-level nesting works correctly

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `scripts/parse-achievement-csv.ts` | Parse CSV to extract requirement IDs |
| `scripts/merge-csv-with-ui.ts` | Merge CSV IDs with scraped UI data |
| `data/csv-requirement-ids.json` | Parsed CSV output |
| `data/scraped-ui-data.json` | Raw scraped UI data |
| `data/discrepancy-report.json` | Flagged items for review |

### Modified Files
| File | Changes |
|------|---------|
| `scripts/scrape-all-merit-badges.ts` | Add depth detection, checkbox detection, link extraction |
| `data/bsa-data-canonical.json` | Replaced with new accurate version |

---

## 5. Testing Strategy

### Automated Validation
- [ ] CSV parser extracts all expected IDs from test export
- [ ] Scraper captures 4-level nesting correctly
- [ ] Link extraction finds all `<a>` tags
- [ ] Merge correctly identifies headers vs requirements
- [ ] Output schema matches import script expectations

### Manual Verification
- [ ] Multisport requirement 4 shows correct 4-level hierarchy
- [ ] All headers have descriptions (no empty headers)
- [ ] Links are accessible and correctly typed
- [ ] Discrepancy report is actionable

---

## 6. Rollout Plan

### Step 1: Run CSV Parser
```bash
npx tsx scripts/parse-achievement-csv.ts path/to/achievement-export.csv
```

### Step 2: Test Single Badges (VALIDATION GATE)
```bash
# Test simple badge
npx tsx scripts/test-single-badge-scrape.ts "First Aid"

# Test bracket notation
npx tsx scripts/test-single-badge-scrape.ts "Environmental Science"

# Test 4-deep nesting
npx tsx scripts/test-single-badge-scrape.ts "Multisport"
```

**STOP HERE** - Review output for each test badge:
- Does hierarchy match Scoutbook UI?
- Are headers correctly identified?
- Are links captured?
- Do requirement IDs match CSV?

Only proceed to full scrape after all 3 test badges validated.

### Step 3: Run Enhanced Scraper (Overnight)
```bash
npx tsx scripts/scrape-all-merit-badges.ts
```

### Step 3: Run Merge Script
```bash
npx tsx scripts/merge-csv-with-ui.ts
```

### Step 4: Review Discrepancies
- Open `data/discrepancy-report.json`
- Resolve each item manually
- Re-run merge if needed

### Step 5: Replace Canonical File
```bash
cp data/bsa-data-canonical-new.json data/bsa-data-canonical.json
npm run db:fresh  # Re-seed database
```

### Step 6: Verify in App
- Check advancement pages show correct hierarchy
- Verify links are displayed
- Test complex badges (Multisport, Archery)

---

## 6.5 Test Badge Expected Results

### First Aid (Simple Structure)
```
Expected hierarchy:
1 (header: "Do the following:")
  └─ 1a (requirement)
  └─ 1b (requirement)
2 (header: "Do the following:")
  └─ 2a (requirement)
  └─ 2b (requirement)
...

Validation checks:
- [ ] All numbered headers (1, 2, 3...) identified as is_header=true
- [ ] Sub-requirements (a, b, c) have parent pointing to numbered header
- [ ] Requirement IDs match CSV exactly
```

### Environmental Science (Bracket Notation)
```
Expected hierarchy:
3 (header: "Do ONE activity from SEVEN of the following...")
  └─ 3a (header: "Ecology")
      └─ 3a[1] (requirement: "Conduct an experiment...")
      └─ 3a[2] (requirement: "Conduct an experiment...")
  └─ 3b (header: "Air Pollution")
      └─ 3b[1] (requirement)
      └─ 3b[2] (requirement)
...

Validation checks:
- [ ] 3-level nesting captured: 3 → 3a → 3a[1]
- [ ] Section headers (3a, 3b, etc.) identified as is_header=true
- [ ] Bracket notation requirements have correct IDs
- [ ] All 8 sections (a through h) present
```

### Multisport (4-Deep Nesting)
```
Expected hierarchy:
4 (header: "Complete ALL of the activities...")
  └─ Triathlon Option (header)
      └─ (a) Swimming (header)
          └─ (1) (requirement: "Before doing requirements 5...")
          └─ (2) (requirement: "Explain the components...")
          └─ (3) (requirement: "Explain to your counselor...")
      └─ (b) Cycling (header)
          └─ (1) (requirement)
          └─ (2) (requirement)
          └─ (3) (requirement)
      └─ (c) Running (header)
          └─ (1) (requirement)
          └─ (2) (requirement)
          └─ (3) (requirement)
  └─ Duathlon Option (header)
      └─ ...
  └─ Aquathlon Option (header)
      └─ ...
  └─ Aquabike Option (header)
      └─ ...

Validation checks:
- [ ] 4-level nesting captured: 4 → Option → Section → Item
- [ ] All 4 sport options present as separate branches
- [ ] Option headers identified correctly
- [ ] Section headers (a, b, c) identified within each option
- [ ] Requirement IDs match CSV format (e.g., "4a1 Triathlon Option")
```

---

## 7. Future: Rank Requirements

After this process is validated for merit badges, apply the same approach to rank requirements:
1. Parse rank requirements from CSV
2. Scrape rank requirement UI
3. Merge and validate
4. Add to canonical file

---

## 8. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 (CSV) | 2 | 2 | ✅ Complete |
| Phase 1 (Scraper Updates) | 5 | 5 | ✅ Complete |
| Phase 2 (Merge Logic) | 5 | 5 | ✅ Complete |
| Phase 0.5 (Test Validation) | 12 | 2 | 🔄 Ready for Testing |
| Phase 3 (Output) | 4 | 0 | ⬜ Pending Scrape |

### Validation Gate
**Before running full scrape, ALL test badges must pass:**
- [ ] First Aid (simple) ✓
- [ ] Environmental Science (bracket notation) ✓
- [ ] Multisport (4-deep nesting) ✓

---

## 9. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 0.1.1 CSV Parser | 2026-01-28 | 883e21e | Created `scripts/parse-achievement-csv.ts` |
| 0.1.2 CSV Validation | 2026-01-28 | 883e21e | 129 badges, 345 versions, 8,937 requirement IDs extracted |
| 1.1.1-4 Scraper Updates | 2026-01-28 | 883e21e | Added visual depth, checkbox detection, link extraction, raw HTML |
| 0.2.1 Test Script | 2026-01-28 | 883e21e | Created `scripts/test-single-badge-scrape.ts` |
| 0.2.2 Test Expectations | 2026-01-28 | pending | Created `data/test-badge-expectations.json` with version targets |
| 2.1.1-3 Merge Script | 2026-01-28 | pending | Created `scripts/merge-csv-with-ui.ts` with hierarchy building |
| 2.2.1-3 Discrepancy Detection | 2026-01-28 | pending | Integrated into merge script |

---

## Approval

- [ ] Requirements reviewed
- [ ] Technical design reviewed
- [ ] Ready for implementation
