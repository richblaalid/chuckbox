#!/usr/bin/env npx tsx
/**
 * Diagnose Option-Heavy Badges
 *
 * Compares scraped vs canonical IDs for badges with complex option structures
 * to determine if we need to fix the scraper before merging.
 *
 * Usage:
 *   npx tsx scripts/diagnose-option-badges.ts
 *   npx tsx scripts/diagnose-option-badges.ts "Plant Science" 2023
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadge {
  badgeName: string
  versionYear: number
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  badges: ScrapedBadge[]
}

// Problem badges with high unmatched counts
const PROBLEM_BADGES = [
  { name: 'Plant Science', year: 2023 },
  { name: 'Skating', year: 2024 },
  { name: 'Snow Sports', year: 2026 },
  { name: 'Rifle Shooting', year: 2025 },
  { name: 'Archery', year: 2025 },
  { name: 'Golf', year: 2024 },
  { name: 'Animal Science', year: 2025 },
  { name: 'Multisport', year: 2025 },
]

async function diagnoseBadge(
  supabase: any,
  scrapedData: ScrapedData,
  badgeName: string,
  versionYear: number
) {
  console.log('='.repeat(80))
  console.log(`${badgeName} ${versionYear}`)
  console.log('='.repeat(80))
  console.log('')

  // Get scraped data
  const scrapedBadge = scrapedData.badges.find(
    b => b.badgeName === badgeName && b.versionYear === versionYear
  )

  if (!scrapedBadge) {
    console.log('  No scraped data found')
    return
  }

  // Get canonical data
  const { data: version } = await supabase
    .from('merit_badge_versions')
    .select('id')
    .eq('badge_name', badgeName)
    .eq('version_year', versionYear)
    .single()

  if (!version) {
    console.log('  No canonical data found')
    return
  }

  const { data: canonicalReqs } = await supabase
    .from('merit_badge_requirements')
    .select('scoutbook_id, main_req, option_name, option_letter, section, item, sort_order')
    .eq('badge_version_id', version.id)
    .order('sort_order')

  // Build sets for comparison
  const scrapedIds = new Set(scrapedBadge.requirements.map(r => r.number))
  const canonicalIds = new Set(canonicalReqs?.map((r: any) => r.scoutbook_id) || [])

  // Find matches and differences
  const matched = [...scrapedIds].filter(id => canonicalIds.has(id))
  const scrapedOnly = [...scrapedIds].filter(id => !canonicalIds.has(id))
  const canonicalOnly = [...canonicalIds].filter(id => !scrapedIds.has(id as string))

  console.log(`Scraped requirements: ${scrapedBadge.requirements.length}`)
  console.log(`Canonical requirements: ${canonicalReqs?.length || 0}`)
  console.log(`Direct matches: ${matched.length}`)
  console.log('')

  // Show option-related IDs side by side
  console.log('CANONICAL IDs (from Scoutbook CSV):')
  console.log('-'.repeat(80))

  // Group by main requirement for readability
  const canonicalByMain = new Map<string, any[]>()
  for (const req of canonicalReqs || []) {
    const main = req.main_req || '?'
    if (!canonicalByMain.has(main)) {
      canonicalByMain.set(main, [])
    }
    canonicalByMain.get(main)!.push(req)
  }

  // Show first few requirements of each main group, focusing on options
  let shown = 0
  for (const [main, reqs] of canonicalByMain) {
    const hasOptions = reqs.some((r: any) => r.option_name || r.option_letter)
    if (hasOptions || reqs.length > 3) {
      console.log(`  Req ${main}:`)
      for (const req of reqs.slice(0, 8)) {
        const parts = []
        if (req.option_name) parts.push(`opt:${req.option_name}`)
        if (req.option_letter) parts.push(`letter:${req.option_letter}`)
        if (req.section) parts.push(`sec:${req.section}`)
        if (req.item) parts.push(`item:${req.item}`)
        console.log(`    "${req.scoutbook_id}" → ${parts.join(', ') || '(main)'}`)
      }
      if (reqs.length > 8) {
        console.log(`    ... and ${reqs.length - 8} more`)
      }
      shown++
      if (shown >= 5) break
    }
  }

  console.log('')
  console.log('SCRAPED IDs (from web scraper):')
  console.log('-'.repeat(80))

  // Group scraped by parent
  const scrapedByParent = new Map<string, ScrapedRequirement[]>()
  for (const req of scrapedBadge.requirements) {
    const parent = req.parentNumber || 'root'
    if (!scrapedByParent.has(parent)) {
      scrapedByParent.set(parent, [])
    }
    scrapedByParent.get(parent)!.push(req)
  }

  // Show scraped items that look like they should have options
  shown = 0
  for (const [parent, reqs] of scrapedByParent) {
    if (parent === 'root') continue
    const hasOptionLike = reqs.some(r =>
      /opt|option|[A-H]$/i.test(r.number) ||
      r.description.toLowerCase().includes('option') ||
      /^(swimming|biking|running|ice|alpine)/i.test(r.description)
    )
    if (hasOptionLike || reqs.length > 5) {
      console.log(`  Parent ${parent}:`)
      for (const req of reqs.slice(0, 8)) {
        const desc = req.description.substring(0, 50)
        const marker = canonicalIds.has(req.number) ? '✓' : '✗'
        console.log(`    ${marker} "${req.number}" → "${desc}..."`)
      }
      if (reqs.length > 8) {
        console.log(`    ... and ${reqs.length - 8} more`)
      }
      shown++
      if (shown >= 5) break
    }
  }

  console.log('')
  console.log('ID PATTERN COMPARISON:')
  console.log('-'.repeat(80))

  // Show examples of unmatched pairs that look similar
  const unmatchedCanonical = canonicalOnly.slice(0, 15)
  const unmatchedScraped = scrapedOnly.slice(0, 15)

  console.log('  Unmatched CANONICAL (need scraped equivalent):')
  for (const id of unmatchedCanonical) {
    console.log(`    - "${id}"`)
  }

  console.log('')
  console.log('  Unmatched SCRAPED (no canonical match):')
  for (const id of unmatchedScraped) {
    console.log(`    + "${id}"`)
  }

  // Try to identify pattern mismatches
  console.log('')
  console.log('PATTERN ANALYSIS:')
  console.log('-'.repeat(80))

  // Check for common transformations needed
  const patterns = {
    trailingPeriod: unmatchedCanonical.filter(id => (id as string).endsWith('.')).length,
    optSuffix: unmatchedCanonical.filter(id => / Opt [A-Z]/.test(id as string)).length,
    optionSuffix: unmatchedCanonical.filter(id => / Option [A-Z]/.test(id as string)).length,
    namedOption: unmatchedCanonical.filter(id => / (Triathlon|Duathlon|Ice|Alpine|avian|beef) /i.test(id as string)).length,
    parenthetical: unmatchedCanonical.filter(id => /\(\d+\)/.test(id as string)).length,
    bracket: unmatchedCanonical.filter(id => /\[\d+\]/.test(id as string)).length,
  }

  console.log('  Canonical patterns in unmatched:')
  for (const [pattern, count] of Object.entries(patterns)) {
    if (count > 0) {
      console.log(`    ${pattern}: ${count}`)
    }
  }

  const scrapedPatterns = {
    uppercaseLetter: unmatchedScraped.filter(id => /[A-Z][a-z]/.test(id)).length,
    underscoreSuffix: unmatchedScraped.filter(id => /_\d+$/.test(id)).length,
    parenNumber: unmatchedScraped.filter(id => /\(\d+\)/.test(id)).length,
    optionWord: unmatchedScraped.filter(id => /option/i.test(id)).length,
  }

  console.log('  Scraped patterns in unmatched:')
  for (const [pattern, count] of Object.entries(scrapedPatterns)) {
    if (count > 0) {
      console.log(`    ${pattern}: ${count}`)
    }
  }

  console.log('')
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load scraped data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))

  // Check if specific badge requested
  const args = process.argv.slice(2)
  if (args.length >= 2) {
    const badgeName = args[0]
    const year = parseInt(args[1], 10)
    await diagnoseBadge(supabase, scrapedData, badgeName, year)
  } else {
    // Run all problem badges
    for (const badge of PROBLEM_BADGES) {
      await diagnoseBadge(supabase, scrapedData, badge.name, badge.year)
    }
  }
}

main().catch(console.error)
