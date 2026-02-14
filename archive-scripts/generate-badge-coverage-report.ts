#!/usr/bin/env npx tsx
/**
 * Generate Merit Badge Coverage Report
 *
 * Creates a comprehensive report of all merit badges and versions,
 * showing which have canonical Scoutbook IDs from our CSV export.
 *
 * Output:
 *   - data/merit-badge-coverage-report.json (structured data)
 *   - Console summary
 */

import * as fs from 'fs'

// ============================================
// Types
// ============================================

interface BadgeVersionStatus {
  year: number
  hasCanonicalData: boolean
  requirementCount: number
  sampleIds: string[]
  idFormat: string  // Detected format pattern
}

interface BadgeCoverage {
  badgeName: string
  isEagleRequired: boolean
  versions: BadgeVersionStatus[]
  totalVersions: number
  versionsWithData: number
  coveragePercent: number
}

interface CoverageReport {
  generatedAt: string
  summary: {
    totalBadges: number
    badgesWithAnyData: number
    totalVersions: number
    versionsWithData: number
    coveragePercent: number
  }
  badges: BadgeCoverage[]
  missingBadges: string[]  // Badges with 0 canonical data
  partialBadges: string[]  // Badges with some but not all versions
  completeBadges: string[] // Badges with data for all known versions
}

// ============================================
// Known Merit Badges (BSA official list)
// ============================================

// Eagle-required merit badges
const EAGLE_REQUIRED = [
  'Camping',
  'Citizenship in Society',
  'Citizenship in the Community',
  'Citizenship in the Nation',
  'Citizenship in the World',
  'Communication',
  'Cooking',
  'Emergency Preparedness', // or Lifesaving
  'Lifesaving', // or Emergency Preparedness
  'Environmental Science', // or Sustainability
  'Sustainability', // or Environmental Science
  'Family Life',
  'First Aid',
  'Personal Fitness',
  'Personal Management',
  'Swimming', // or Hiking or Cycling
  'Hiking', // or Swimming or Cycling
  'Cycling', // or Swimming or Hiking
]

// All current merit badges (as of 2024-2025)
const ALL_MERIT_BADGES = [
  'American Business',
  'American Cultures',
  'American Heritage',
  'American Indian Culture',
  'Animal Science',
  'Animation',
  'Archaeology',
  'Archery',
  'Architecture',
  'Art',
  'Astronomy',
  'Athletics',
  'Automotive Maintenance',
  'Aviation',
  'Backpacking',
  'Basketry',
  'Bird Study',
  'Bugling',
  'Camping',
  'Canoeing',
  'Chemistry',
  'Chess',
  'Citizenship in Society',
  'Citizenship in the Community',
  'Citizenship in the Nation',
  'Citizenship in the World',
  'Climbing',
  'Coin Collecting',
  'Collections',
  'Communication',
  'Composite Materials',
  'Cooking',
  'Crime Prevention',
  'Cycling',
  'Dentistry',
  'Digital Technology',
  'Disabilities Awareness',
  'Dog Care',
  'Drafting',
  'Electricity',
  'Electronics',
  'Emergency Preparedness',
  'Energy',
  'Engineering',
  'Entrepreneurship',
  'Environmental Science',
  'Exploration',
  'Family Life',
  'Farm Mechanics',
  'Fingerprinting',
  'Fire Safety',
  'First Aid',
  'Fish and Wildlife Management',
  'Fishing',
  'Fly Fishing',
  'Food Science',
  'Forestry',
  'Game Design',
  'Gardening',
  'Genealogy',
  'Geocaching',
  'Geology',
  'Golf',
  'Graphic Arts',
  'Health Care Professions',
  'Hiking',
  'Home Repairs',
  'Horsemanship',
  'Indian Lore',
  'Insect Study',
  'Inventing',
  'Journalism',
  'Kayaking',
  'Landscape Architecture',
  'Law',
  'Leatherwork',
  'Lifesaving',
  'Mammal Study',
  'Medicine',
  'Metalwork',
  'Mining in Society',
  'Model Design and Building',
  'Motorboating',
  'Moviemaking',
  'Multisport',
  'Music',
  'Nature',
  'Nuclear Science',
  'Oceanography',
  'Orienteering',
  'Painting',
  'Personal Fitness',
  'Personal Management',
  'Pets',
  'Photography',
  'Pioneering',
  'Plant Science',
  'Plumbing',
  'Pottery',
  'Programming',
  'Public Health',
  'Public Speaking',
  'Pulp and Paper',
  'Radio',
  'Railroading',
  'Reading',
  'Reptile and Amphibian Study',
  'Rifle Shooting',
  'Robotics',
  'Rowing',
  'Safety',
  'Salesmanship',
  'Scholarship',
  'Scouting Heritage',
  'Scuba Diving',
  'Sculpture',
  'Search and Rescue',
  'Shotgun Shooting',
  'Signs, Signals, and Codes',
  'Skating',
  'Small-Boat Sailing',
  'Snow Sports',
  'Soil and Water Conservation',
  'Space Exploration',
  'Sports',
  'Stamp Collecting',
  'Surveying',
  'Sustainability',
  'Swimming',
  'Textile',
  'Theater',
  'Traffic Safety',
  'Truck Transportation',
  'Veterinary Medicine',
  'Water Sports',
  'Weather',
  'Welding',
  'Whitewater',
  'Wilderness Survival',
  'Wood Carving',
  'Woodwork',
]

// ============================================
// ID Format Detection
// ============================================

function detectIdFormat(ids: string[]): string {
  if (ids.length === 0) return 'unknown'

  const patterns = {
    '2026_parenthetical': /^\d+\([a-z]\)$/,           // 1(a)
    '2026_nested': /^\d+\([a-z]\)\(\d+\)$/,           // 1(a)(1)
    '2026_option': /^\d+ Option [A-H]/,               // 4 Option A
    'pre2026_simple': /^\d+[a-z]$/,                   // 1a
    'pre2026_bracket': /^\d+[a-z]\[\d+\]$/,           // 2b[1]
    'pre2026_opt': / Opt [A-Z]$/,                     // 5a Opt B
    'named_option': / (Triathlon|Duathlon|Ice|Alpine) Option$/,  // 4a1 Triathlon Option
    'sport_suffix': / (Ice|Inline|Alpine|Nordic|Snow)$/,         // 2a[1] Ice
  }

  const counts: Record<string, number> = {}
  for (const id of ids) {
    for (const [name, pattern] of Object.entries(patterns)) {
      if (pattern.test(id)) {
        counts[name] = (counts[name] || 0) + 1
      }
    }
  }

  // Return the most common pattern
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (sorted.length > 0) {
    return sorted[0][0]
  }

  // Check for simple numeric
  if (ids.some(id => /^\d+$/.test(id))) {
    return 'numeric_only'
  }

  return 'mixed'
}

// ============================================
// Main Report Generation
// ============================================

function generateReport(): CoverageReport {
  // Load canonical data
  const canonicalPath = 'data/scoutbook-requirement-ids.json'
  const canonicalData: Record<string, Record<string, string[]>> =
    fs.existsSync(canonicalPath)
      ? JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))
      : {}

  const badges: BadgeCoverage[] = []
  const missingBadges: string[] = []
  const partialBadges: string[] = []
  const completeBadges: string[] = []

  let totalVersions = 0
  let versionsWithData = 0

  for (const badgeName of ALL_MERIT_BADGES) {
    const canonicalVersions = canonicalData[badgeName] || {}
    const versionYears = Object.keys(canonicalVersions).map(y => parseInt(y, 10)).sort()

    const versions: BadgeVersionStatus[] = []

    // If we have canonical data, use those versions
    if (versionYears.length > 0) {
      for (const year of versionYears) {
        const ids = canonicalVersions[String(year)] || []
        versions.push({
          year,
          hasCanonicalData: ids.length > 0,
          requirementCount: ids.length,
          sampleIds: ids.slice(0, 3),
          idFormat: detectIdFormat(ids)
        })
        totalVersions++
        if (ids.length > 0) versionsWithData++
      }
    } else {
      // No canonical data - mark as missing
      // We don't know the versions, so just note it's missing
      totalVersions++ // Count as at least one potential version
    }

    const versionsWithDataCount = versions.filter(v => v.hasCanonicalData).length

    const coverage: BadgeCoverage = {
      badgeName,
      isEagleRequired: EAGLE_REQUIRED.includes(badgeName),
      versions,
      totalVersions: versions.length || 1,
      versionsWithData: versionsWithDataCount,
      coveragePercent: versions.length > 0
        ? Math.round((versionsWithDataCount / versions.length) * 100)
        : 0
    }

    badges.push(coverage)

    // Categorize
    if (versionsWithDataCount === 0) {
      missingBadges.push(badgeName)
    } else if (versionsWithDataCount < versions.length) {
      partialBadges.push(badgeName)
    } else {
      completeBadges.push(badgeName)
    }
  }

  // Sort badges by coverage (lowest first for easy identification of gaps)
  badges.sort((a, b) => {
    // Eagle required first
    if (a.isEagleRequired !== b.isEagleRequired) {
      return a.isEagleRequired ? -1 : 1
    }
    // Then by coverage
    return a.coveragePercent - b.coveragePercent
  })

  const badgesWithAnyData = badges.filter(b => b.versionsWithData > 0).length

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalBadges: ALL_MERIT_BADGES.length,
      badgesWithAnyData,
      totalVersions,
      versionsWithData,
      coveragePercent: Math.round((versionsWithData / totalVersions) * 100)
    },
    badges,
    missingBadges,
    partialBadges,
    completeBadges
  }
}

function printReport(report: CoverageReport): void {
  console.log('='.repeat(80))
  console.log('MERIT BADGE CANONICAL DATA COVERAGE REPORT')
  console.log('='.repeat(80))
  console.log(`Generated: ${report.generatedAt}`)
  console.log('')

  // Summary
  console.log('SUMMARY')
  console.log('-'.repeat(40))
  console.log(`Total merit badges: ${report.summary.totalBadges}`)
  console.log(`Badges with any canonical data: ${report.summary.badgesWithAnyData}`)
  console.log(`Total badge-versions: ${report.summary.totalVersions}`)
  console.log(`Versions with canonical data: ${report.summary.versionsWithData}`)
  console.log(`Overall coverage: ${report.summary.coveragePercent}%`)
  console.log('')

  // Eagle Required Coverage
  console.log('EAGLE-REQUIRED MERIT BADGES')
  console.log('-'.repeat(40))
  const eagleRequired = report.badges.filter(b => b.isEagleRequired)
  for (const badge of eagleRequired) {
    const status = badge.versionsWithData > 0 ? '✅' : '❌'
    const versions = badge.versions.map(v => `${v.year}(${v.requirementCount})`).join(', ')
    console.log(`${status} ${badge.badgeName}: ${badge.versionsWithData}/${badge.totalVersions} versions`)
    if (badge.versions.length > 0) {
      console.log(`   Versions: ${versions}`)
    }
  }
  console.log('')

  // Missing badges (no data at all)
  console.log('BADGES WITH NO CANONICAL DATA')
  console.log('-'.repeat(40))
  if (report.missingBadges.length === 0) {
    console.log('  None! All badges have at least some data.')
  } else {
    for (const name of report.missingBadges) {
      const isEagle = EAGLE_REQUIRED.includes(name) ? ' [EAGLE]' : ''
      console.log(`  ❌ ${name}${isEagle}`)
    }
  }
  console.log(`Total missing: ${report.missingBadges.length}`)
  console.log('')

  // Badges with complete data
  console.log('BADGES WITH COMPLETE DATA (all versions covered)')
  console.log('-'.repeat(40))
  console.log(`Total: ${report.completeBadges.length} badges`)
  console.log('')

  // Version format analysis
  console.log('ID FORMAT ANALYSIS BY YEAR')
  console.log('-'.repeat(40))
  const formatsByYear: Record<number, Record<string, number>> = {}
  for (const badge of report.badges) {
    for (const version of badge.versions) {
      if (!formatsByYear[version.year]) {
        formatsByYear[version.year] = {}
      }
      const fmt = version.idFormat
      formatsByYear[version.year][fmt] = (formatsByYear[version.year][fmt] || 0) + 1
    }
  }
  const years = Object.keys(formatsByYear).map(Number).sort()
  for (const year of years) {
    const formats = formatsByYear[year]
    const formatStr = Object.entries(formats)
      .sort((a, b) => b[1] - a[1])
      .map(([f, c]) => `${f}:${c}`)
      .join(', ')
    console.log(`  ${year}: ${formatStr}`)
  }
  console.log('')

  // Complex badges (those with options/special structures)
  console.log('COMPLEX BADGES (Options/Special Structures)')
  console.log('-'.repeat(40))
  const complexPatterns = ['2026_option', 'pre2026_opt', 'named_option', 'sport_suffix']
  const complexBadges = report.badges.filter(b =>
    b.versions.some(v => complexPatterns.includes(v.idFormat))
  )
  for (const badge of complexBadges) {
    const formats = [...new Set(badge.versions.map(v => v.idFormat))].join(', ')
    console.log(`  ${badge.badgeName}: ${formats}`)
  }
  console.log(`Total complex badges: ${complexBadges.length}`)
}

// ============================================
// Generate SQL for Database Schema
// ============================================

function generateDatabaseSchema(): string {
  return `
-- Merit Badge Reference Data Schema
-- Stores canonical Scoutbook requirement IDs for matching and validation

-- Table: merit_badge_versions
-- Tracks all known merit badge versions and their canonical data status
CREATE TABLE IF NOT EXISTS merit_badge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_name TEXT NOT NULL,
  badge_slug TEXT NOT NULL,
  version_year INTEGER NOT NULL,
  is_eagle_required BOOLEAN DEFAULT FALSE,
  has_canonical_data BOOLEAN DEFAULT FALSE,
  requirement_count INTEGER DEFAULT 0,
  id_format TEXT,  -- Detected format pattern (e.g., '2026_parenthetical', 'pre2026_simple')
  canonical_source TEXT,  -- Where the canonical data came from (e.g., 'csv_export_2026-01-24')
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(badge_name, version_year)
);

-- Table: merit_badge_requirements
-- Stores the canonical requirement IDs and text for each badge version
CREATE TABLE IF NOT EXISTS merit_badge_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_version_id UUID NOT NULL REFERENCES merit_badge_versions(id) ON DELETE CASCADE,
  scoutbook_id TEXT NOT NULL,  -- The canonical Scoutbook requirement ID
  display_label TEXT,          -- What's shown in the UI (e.g., "(a)", "(1)")
  description TEXT,            -- Requirement text
  parent_id UUID REFERENCES merit_badge_requirements(id),  -- For hierarchical display
  depth INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_header BOOLEAN DEFAULT FALSE,  -- True for option/section headers

  -- Hierarchy position for ID construction
  main_req TEXT,
  option_name TEXT,
  option_letter TEXT,
  section TEXT,
  item TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(badge_version_id, scoutbook_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_badge_name ON merit_badge_versions(badge_name);
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_year ON merit_badge_versions(version_year);
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_has_canonical ON merit_badge_versions(has_canonical_data);
CREATE INDEX IF NOT EXISTS idx_merit_badge_requirements_version ON merit_badge_requirements(badge_version_id);
CREATE INDEX IF NOT EXISTS idx_merit_badge_requirements_scoutbook_id ON merit_badge_requirements(scoutbook_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_merit_badge_versions_updated_at ON merit_badge_versions;
CREATE TRIGGER update_merit_badge_versions_updated_at
  BEFORE UPDATE ON merit_badge_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merit_badge_requirements_updated_at ON merit_badge_requirements;
CREATE TRIGGER update_merit_badge_requirements_updated_at
  BEFORE UPDATE ON merit_badge_requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE merit_badge_versions IS 'Tracks all known merit badge versions and canonical data availability';
COMMENT ON TABLE merit_badge_requirements IS 'Stores canonical Scoutbook requirement IDs for each badge version';
COMMENT ON COLUMN merit_badge_requirements.scoutbook_id IS 'The canonical ID used by Scoutbook (e.g., "4 Option A (1)(a)")';
COMMENT ON COLUMN merit_badge_versions.id_format IS 'Detected ID format pattern for this version';
`;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('Generating merit badge coverage report...\n')

  const report = generateReport()

  // Print to console
  printReport(report)

  // Save JSON report
  const reportPath = 'data/merit-badge-coverage-report.json'
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport saved to: ${reportPath}`)

  // Save database schema
  const schemaPath = 'supabase/migrations/20260124_merit_badge_reference_tables.sql'
  const schema = generateDatabaseSchema()

  // Check if migrations directory exists
  if (!fs.existsSync('supabase/migrations')) {
    fs.mkdirSync('supabase/migrations', { recursive: true })
  }

  fs.writeFileSync(schemaPath, schema)
  console.log(`Database schema saved to: ${schemaPath}`)

  // Summary for quick reference
  console.log('\n' + '='.repeat(80))
  console.log('QUICK SUMMARY')
  console.log('='.repeat(80))
  console.log(`✅ Badges with data: ${report.summary.badgesWithAnyData}/${report.summary.totalBadges}`)
  console.log(`❌ Badges missing: ${report.missingBadges.length}`)
  console.log(`📊 Overall coverage: ${report.summary.coveragePercent}%`)
}

main().catch(console.error)
