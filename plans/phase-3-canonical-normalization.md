# Phase 3: Canonical Data Normalization

## Overview

**Goal**: Fix the `bsa-data-canonical.json` source data so the seeder produces correct structures without needing runtime fix scripts.

**Outcome**: Zero validation errors after seeding from normalized canonical data.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Output file | Create new `bsa-data-canonical-normalized.json` (preserves original) |
| Fix scripts | Keep as fallback in registry (disabled by default) |
| Scope | All 34 complex badge versions |
| Standard format | `{Level}{Option}({Number})({Letter})` e.g., `6A(1)(a)` |

## Current State

**Validation Issues** (132 total across 10 badges):
- 107 inconsistent_nesting
- 25 header_no_children

**34 Complex Badge Versions** need normalization:
- Archery (3 versions)
- Cycling (3 versions) - has fix script
- Multisport (2 versions) - has fix script
- Plant Science (4 versions) - deepest nesting (level 5)
- Skating (3 versions)
- Radio, Golf, Nature, Geology, etc.

## Standard Requirement Number Format

```
Top-level:     1, 2, 3, ...
Sub-level:     1a, 1b, 1c, ... (lowercase letters)
Sub-sub:       1a(1), 1a(2), ... (wrapped numbers)
Sub-sub-sub:   1a(1)(a), 1a(1)(b), ... (wrapped letters)
Options:       4A, 4B, 4C (uppercase letter after number)
Option subs:   4A(1), 4A(2), ... then 4A(1)(a), etc.
```

## Normalization Patterns

### Pattern 1: Underscore to Parenthetical
```
4Aa_2  →  4A(2)(a)
6A(a)_3  →  6A(3)(a)
```

### Pattern 2: Standardize Option Format
```
"6 Option A(1)"  →  "6A(1)"
"4Aa"  →  "4A(1)(a)"
"5a Opt A"  →  "5A(a)"
```

### Pattern 3: Extract Sub-Version Numbers
```
"6A(e)(2)"  →  "6A(2)"    (e was placeholder)
"4Ac(3)"  →  "4A(3)"      (c was placeholder)
```

### Pattern 4: Bracket to Parenthetical
```
"9a[1]"  →  "9a(1)"
"2a[1] Ice"  →  "2A(1)"   (strip type labels)
```

### Pattern 5: Recalculate Hierarchy
- Set `is_header = (children.length > 0)`
- Set `nesting_depth` from parent chain
- Verify each requirement has valid parent

### Pattern 6: Insert Missing Headers
```
If 4A(1)(a), 4A(1)(b) exist but no 4A(1):
  Insert: { requirement_number: "4A(1)", is_header: true, children: [...] }
```

---

## Implementation Tasks

### Phase 0: Foundation ✅ COMPLETE

#### 0.1 Setup

- [x] **0.1.1** Create `scripts/normalize-canonical-data.ts` skeleton with CLI args
- [x] **0.1.2** Define TypeScript interfaces for canonical data structures
- [x] **0.1.3** Add `--dry-run` and `--badge <name>` CLI options
- [x] **0.1.4** Add npm script: `npm run db:normalize`

#### 0.2 Badge Transform Registry

- [x] **0.2.1** Create `data/canonical-transforms.json` with transform rules per badge
- [x] **0.2.2** Define `TransformRule` interface: `{ from: RegExp, to: string, flags?: string }`
- [x] **0.2.3** Add badge-specific rules for Cycling v2026 (from existing fix script)
- [x] **0.2.4** Add badge-specific rules for Multisport v2026 (from existing fix script)

### Phase 1: Core Transformation Engine

#### 1.1 Requirement Number Normalization ✅ COMPLETE

- [x] **1.1.1** Implement `normalizeRequirementNumber(num: string, badgeName: string): string`
- [x] **1.1.2** Apply underscore-to-parenthetical pattern (`_2` → `(2)`)
- [x] **1.1.3** Apply option format standardization (`Option A` → `A`)
- [x] **1.1.4** Apply bracket-to-parenthetical conversion (`[1]` → `(1)`)
- [x] **1.1.5** Strip sport/type labels (`Ice`, `Roll`, etc.)

#### 1.2 Hierarchy Reconstruction

- [ ] **1.2.1** Implement `buildHierarchy(flatReqs: Requirement[]): Requirement[]`
- [ ] **1.2.2** Calculate parent from requirement number (remove innermost level)
- [ ] **1.2.3** Identify missing parent headers
- [ ] **1.2.4** Insert synthetic headers with descriptions
- [ ] **1.2.5** Set `is_header` based on children presence

#### 1.3 Depth & Order Calculation

- [ ] **1.3.1** Implement `calculateNestingDepth(req: Requirement): number`
- [ ] **1.3.2** Implement `assignDisplayOrders(reqs: Requirement[]): void`
- [ ] **1.3.3** Validate parent chain matches nesting depth

### Phase 2: Badge-Specific Transforms

#### 2.1 Option-Pattern Badges (8 badges)

- [ ] **2.1.1** Add transforms for Cycling (3 versions)
- [ ] **2.1.2** Add transforms for Multisport (2 versions)
- [ ] **2.1.3** Add transforms for Golf (2024)
- [ ] **2.1.4** Add transforms for Journalism (2024)

#### 2.2 Bracket-Pattern Badges (6 badges)

- [ ] **2.2.1** Add transforms for Nature (2025)
- [ ] **2.2.2** Add transforms for Shotgun Shooting (2014, 2026)
- [ ] **2.2.3** Add transforms for Radio (2017, 2026)
- [ ] **2.2.4** Add transforms for Skating (2016, 2024, 2026)

#### 2.3 Deep-Nesting Badges (4 badges)

- [ ] **2.3.1** Add transforms for Archery (2019, 2023, 2025)
- [ ] **2.3.2** Add transforms for Plant Science (2014, 2017, 2023, 2026)

#### 2.4 Header-Orphan Badges (8 badges)

- [ ] **2.4.1** Add transforms for Animal Science (2025)
- [ ] **2.4.2** Add transforms for Geology (2026)
- [ ] **2.4.3** Add transforms for Metalwork (2025)
- [ ] **2.4.4** Add transforms for Snow Sports (2026)
- [ ] **2.4.5** Add transforms for Insect Study (2025)
- [ ] **2.4.6** Add transforms for Disabilities Awareness (2017, 2021)

#### 2.5 Remaining Complex Badges

- [ ] **2.5.1** Add transforms for Athletics (2026)
- [ ] **2.5.2** Add transforms for Railroading (2022)
- [ ] **2.5.3** Add transforms for Rifle Shooting (2002, 2019, 2025)
- [ ] **2.5.4** Add transforms for Whitewater (2020, 2026)

### Phase 3: Output & Integration

#### 3.1 Output Generation

- [ ] **3.1.1** Write normalized data to `bsa-data-canonical-normalized.json`
- [ ] **3.1.2** Generate transformation report with before/after stats
- [ ] **3.1.3** Log summary: badges processed, issues fixed, remaining issues

#### 3.2 Validation Integration

- [ ] **3.2.1** Run `validate-bsa-structure.ts` against normalized data (mock DB)
- [ ] **3.2.2** Compare validation results: original vs normalized
- [ ] **3.2.3** Ensure zero validation errors on normalized data

#### 3.3 Seeder Integration

- [ ] **3.3.1** Add `CANONICAL_DATA_FILE` env var to seeder (default: `bsa-data-canonical.json`)
- [ ] **3.3.2** Update `npm run db:fresh` to use normalized file
- [ ] **3.3.3** Disable existing fix scripts in registry (keep as fallback)

#### 3.4 Documentation

- [ ] **3.4.1** Update `docs/bsa-requirements-stability.md` with Phase 3 completion
- [ ] **3.4.2** Update CLAUDE.md with normalization workflow
- [ ] **3.4.3** Add migration guide: how to add new badge transforms

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `scripts/normalize-canonical-data.ts` | Main normalization script |
| `data/canonical-transforms.json` | Badge-specific transform rules |
| `data/bsa-data-canonical-normalized.json` | Output file |
| `data/normalization-report.json` | Transformation stats |

### Modified Files
| File | Change |
|------|--------|
| `package.json` | Add `db:normalize` script |
| `scripts/bsa-reference-data.ts` | Support alternate canonical file |
| `data/requirement-fixes.json` | Disable fix scripts (set `enabled: false`) |
| `docs/bsa-requirements-stability.md` | Mark Phase 3 complete |
| `CLAUDE.md` | Document normalization workflow |

---

## Testing Strategy

### Unit Tests
- [ ] Test `normalizeRequirementNumber()` with all 6 patterns
- [ ] Test `buildHierarchy()` with sample badge data
- [ ] Test `calculateNestingDepth()` edge cases

### Integration Tests
- [ ] Normalize single badge (Cycling) and verify structure
- [ ] Normalize all badges and compare validation results
- [ ] Seed from normalized file and verify zero issues

### Validation Criteria
```
Before: 132 issues across 10 badges
After:  0 issues across 141 badges
```

---

## Success Criteria

1. **Zero Validation Errors**: `npm run db:validate` reports 0 issues after seeding from normalized data
2. **Idempotent**: Running normalization twice produces identical output
3. **Reversible**: Original canonical file preserved for comparison
4. **Documented**: Transform rules are explicit in registry, not hidden in code

---

## Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 0.1.1-0.2.4 | 2026-02-11 | - | Phase 0 Foundation complete |
| 1.1.1-1.1.5 | 2026-02-11 | - | Requirement number normalization complete (1657 changes across 95 versions) |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Transforms break valid data | Dry-run mode, compare before/after |
| Missing edge cases | Keep fix scripts as fallback |
| Seeder incompatibility | Feature flag for canonical file path |
| Scout progress data loss | Normalization only affects reference data, not progress |

---

## Estimated Effort

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 0 | 8 | Low - Setup |
| Phase 1 | 11 | Medium - Core engine |
| Phase 2 | 18 | High - Badge-specific rules |
| Phase 3 | 10 | Medium - Integration |
| **Total** | **47 tasks** | |
