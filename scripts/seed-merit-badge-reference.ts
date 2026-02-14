#!/usr/bin/env npx tsx
/**
 * Seed Merit Badge Reference Tables
 *
 * Populates the merit_badge_versions and merit_badge_requirements tables
 * with canonical data from our Scoutbook CSV export.
 *
 * Usage:
 *   npx tsx scripts/seed-merit-badge-reference.ts
 *
 * Prerequisites:
 *   - Run the migration first: supabase db push
 *   - Have data/scoutbook-requirement-ids.json (from analyze-csv-coverage.ts)
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ============================================
// Configuration
// ============================================

const EAGLE_REQUIRED = [
  'Camping', 'Citizenship in Society', 'Citizenship in the Community',
  'Citizenship in the Nation', 'Citizenship in the World', 'Communication',
  'Cooking', 'Emergency Preparedness', 'Lifesaving', 'Environmental Science',
  'Sustainability', 'Family Life', 'First Aid', 'Personal Fitness',
  'Personal Management', 'Swimming', 'Hiking', 'Cycling',
]

// ============================================
// ID Format Detection
// ============================================

function detectIdFormat(ids: string[]): string {
  if (ids.length === 0) return 'unknown'

  const patterns: [string, RegExp][] = [
    ['2026_parenthetical', /^\d+\([a-z]\)$/],
    ['2026_nested', /^\d+\([a-z]\)\(\d+\)$/],
    ['2026_option', /^\d+ Option [A-H]/],
    ['pre2026_simple', /^\d+[a-z]$/],
    ['pre2026_bracket', /^\d+[a-z]\[\d+\]$/],
    ['pre2026_opt', / Opt [A-Z]$/],
    ['named_option', / (Triathlon|Duathlon|Ice|Alpine) Option$/],
    ['sport_suffix', / (Ice|Inline|Alpine|Nordic|Snow)$/],
  ]

  const counts: Record<string, number> = {}
  for (const id of ids) {
    for (const [name, pattern] of patterns) {
      if (pattern.test(id)) {
        counts[name] = (counts[name] || 0) + 1
      }
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (sorted.length > 0) {
    return sorted[0][0]
  }

  if (ids.some(id => /^\d+$/.test(id))) {
    return 'numeric_only'
  }

  return 'mixed'
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ============================================
// Parse Hierarchy from ID
// ============================================

interface HierarchyPosition {
  mainReq: string
  option?: string
  optionLetter?: string
  section?: string
  item?: string
}

function parseScoutbookId(id: string, versionYear: number): HierarchyPosition {
  const is2026 = versionYear >= 2026

  // Main requirement only (just a number)
  if (/^\d+\.?$/.test(id)) {
    return { mainReq: id.replace('.', '') }
  }

  // 2026 format: "4 Option A (1)(a)"
  const option2026Match = id.match(/^(\d+) Option ([A-H]) \((\d+)\)\(([a-z])\)$/)
  if (option2026Match) {
    return {
      mainReq: option2026Match[1],
      option: `Option ${option2026Match[2]}`,
      optionLetter: option2026Match[2],
      section: option2026Match[3],
      item: option2026Match[4]
    }
  }

  // 2026 format: "4 Option A (1)"
  const option2026SimpleMatch = id.match(/^(\d+) Option ([A-H]) \((\d+)\)$/)
  if (option2026SimpleMatch) {
    return {
      mainReq: option2026SimpleMatch[1],
      option: `Option ${option2026SimpleMatch[2]}`,
      optionLetter: option2026SimpleMatch[2],
      section: option2026SimpleMatch[3]
    }
  }

  // 2026 format: "1(a)(1)"
  const nested2026Match = id.match(/^(\d+)\(([a-z])\)\((\d+)\)$/)
  if (nested2026Match) {
    return {
      mainReq: nested2026Match[1],
      section: nested2026Match[2],
      item: nested2026Match[3]
    }
  }

  // 2026 format: "1(a)"
  const simple2026Match = id.match(/^(\d+)\(([a-z])\)$/)
  if (simple2026Match) {
    return {
      mainReq: simple2026Match[1],
      section: simple2026Match[2]
    }
  }

  // Named option: "4a1 Triathlon Option"
  const namedOptionMatch = id.match(/^(\d+)([a-z])(\d+) ([A-Za-z]+) Option$/)
  if (namedOptionMatch) {
    return {
      mainReq: namedOptionMatch[1],
      option: namedOptionMatch[4],
      section: namedOptionMatch[2],
      item: namedOptionMatch[3]
    }
  }

  // Opt suffix: "5a Opt B"
  const optSuffixMatch = id.match(/^(\d+)([a-z]) Opt ([A-Z])$/)
  if (optSuffixMatch) {
    return {
      mainReq: optSuffixMatch[1],
      option: `Option ${optSuffixMatch[3]}`,
      optionLetter: optSuffixMatch[3],
      section: optSuffixMatch[2]
    }
  }

  // Bracket notation: "2b[1]"
  const bracketMatch = id.match(/^(\d+)([a-z])\[(\d+)\]$/)
  if (bracketMatch) {
    return {
      mainReq: bracketMatch[1],
      section: bracketMatch[2],
      item: bracketMatch[3]
    }
  }

  // Simple: "1a" or "1a."
  const simpleMatch = id.match(/^(\d+)([a-z])\.?$/)
  if (simpleMatch) {
    return {
      mainReq: simpleMatch[1],
      section: simpleMatch[2]
    }
  }

  // Fallback - try to extract main requirement number
  const mainMatch = id.match(/^(\d+)/)
  if (mainMatch) {
    return { mainReq: mainMatch[1] }
  }

  return { mainReq: id }
}

// ============================================
// Main Seeding Logic
// ============================================

async function seedMeritBadgeReference() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    console.error('Make sure .env.local is configured')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load canonical data
  const canonicalPath = 'data/scoutbook-requirement-ids.json'
  if (!fs.existsSync(canonicalPath)) {
    console.error(`Canonical data not found: ${canonicalPath}`)
    console.error('Run: npx tsx scripts/analyze-csv-coverage.ts')
    process.exit(1)
  }

  const canonicalData: Record<string, Record<string, string[]>> =
    JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))

  console.log('='.repeat(60))
  console.log('Seeding Merit Badge Reference Tables')
  console.log('='.repeat(60))
  console.log('')

  let versionsInserted = 0
  let requirementsInserted = 0
  let errors: string[] = []

  for (const [badgeName, versions] of Object.entries(canonicalData)) {
    console.log(`Processing: ${badgeName}`)

    for (const [yearStr, requirements] of Object.entries(versions)) {
      const versionYear = parseInt(yearStr, 10)
      const idFormat = detectIdFormat(requirements)

      // Insert badge version
      const { data: versionData, error: versionError } = await supabase
        .from('merit_badge_versions')
        .upsert({
          badge_name: badgeName,
          badge_slug: slugify(badgeName),
          version_year: versionYear,
          is_eagle_required: EAGLE_REQUIRED.includes(badgeName),
          has_canonical_data: requirements.length > 0,
          requirement_count: requirements.length,
          id_format: idFormat,
          canonical_source: 'csv_export_2026-01-24'
        }, {
          onConflict: 'badge_name,version_year'
        })
        .select('id')
        .single()

      if (versionError) {
        errors.push(`${badgeName} ${versionYear}: ${versionError.message}`)
        continue
      }

      versionsInserted++
      const versionId = versionData.id

      // Delete existing requirements for this version (to allow re-seeding)
      await supabase
        .from('merit_badge_requirements')
        .delete()
        .eq('badge_version_id', versionId)

      // Insert requirements
      for (let i = 0; i < requirements.length; i++) {
        const scoutbookId = requirements[i]
        const position = parseScoutbookId(scoutbookId, versionYear)

        const { error: reqError } = await supabase
          .from('merit_badge_requirements')
          .insert({
            badge_version_id: versionId,
            scoutbook_id: scoutbookId,
            display_label: scoutbookId, // We'll update this when we scrape
            description: null, // Will be filled by scraper
            depth: position.option ? (position.item ? 3 : 2) : (position.section ? 1 : 0),
            sort_order: i,
            is_header: false,
            main_req: position.mainReq,
            option_name: position.option,
            option_letter: position.optionLetter,
            section: position.section,
            item: position.item
          })

        if (reqError) {
          errors.push(`${badgeName} ${versionYear} [${scoutbookId}]: ${reqError.message}`)
        } else {
          requirementsInserted++
        }
      }

      console.log(`  ${versionYear}: ${requirements.length} requirements`)
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('SEEDING COMPLETE')
  console.log('='.repeat(60))
  console.log(`Badge versions inserted: ${versionsInserted}`)
  console.log(`Requirements inserted: ${requirementsInserted}`)
  console.log(`Errors: ${errors.length}`)

  if (errors.length > 0) {
    console.log('')
    console.log('Errors:')
    errors.slice(0, 20).forEach(e => console.log(`  - ${e}`))
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more`)
    }
  }
}

seedMeritBadgeReference().catch(console.error)
