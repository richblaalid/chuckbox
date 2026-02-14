#!/usr/bin/env npx tsx

/**
 * Analyze complex merit badges to identify potential nesting/naming issues
 */

import * as fs from 'fs'

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  children?: Requirement[]
}

interface BadgeVersion {
  version_year: number
  requirements: Requirement[]
}

interface MeritBadge {
  name: string
  code: string
  versions: BadgeVersion[]
}

interface CanonicalData {
  merit_badges: MeritBadge[]
}

const data: CanonicalData = JSON.parse(fs.readFileSync('./data/bsa-data-canonical.json', 'utf-8'))

// Collect all requirement numbers recursively
function collectReqs(reqs: Requirement[], depth = 0): Array<{ num: string; id: string; depth: number }> {
  const results: Array<{ num: string; id: string; depth: number }> = []
  for (const r of reqs) {
    results.push({ num: r.requirement_number, id: r.scoutbook_id, depth })
    if (r.children?.length) {
      results.push(...collectReqs(r.children, depth + 1))
    }
  }
  return results
}

// Find badges with Option patterns or complex nesting
const complexBadges: Array<{
  badge: string
  version: number
  reqCount: number
  maxDepth: number
  hasOptions: boolean
  samples: string[]
}> = []

for (const badge of data.merit_badges) {
  for (const version of badge.versions) {
    if (!version.requirements) continue

    const flat = collectReqs(version.requirements)
    const hasOptions = flat.some((r) => /Option|[A-C]\(|^\d+[A-C]$/.test(r.num))
    const maxDepth = Math.max(...flat.map((r) => r.depth))

    if (hasOptions || maxDepth >= 3) {
      complexBadges.push({
        badge: badge.name,
        version: version.version_year,
        reqCount: flat.length,
        maxDepth,
        hasOptions,
        samples: flat.slice(0, 8).map((r) => r.num),
      })
    }
  }
}

console.log('═══════════════════════════════════════════════════════════════')
console.log('             COMPLEX MERIT BADGES ANALYSIS')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Found ${complexBadges.length} badge versions with options or depth >= 3\n`)

for (const b of complexBadges) {
  console.log(`${b.badge} v${b.version}:`)
  console.log(`  Requirements: ${b.reqCount}, Max depth: ${b.maxDepth}, Has options: ${b.hasOptions}`)
  console.log(`  Sample numbers: ${b.samples.join(', ')}`)
  console.log('')
}

// Now check database for inconsistencies
console.log('═══════════════════════════════════════════════════════════════')
console.log('             CHECKING DATABASE STRUCTURE')
console.log('═══════════════════════════════════════════════════════════════')

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkDatabase() {
  // Get badges with option patterns
  const badgesToCheck = ['Cycling', 'Multisport']

  for (const badgeName of badgesToCheck) {
    const { data: badge } = await client
      .from('bsa_merit_badges')
      .select('id, name, requirement_version_year')
      .eq('name', badgeName)
      .single()

    if (!badge) {
      console.log(`\n${badgeName}: Not found in database`)
      continue
    }

    const { data: reqs } = await client
      .from('bsa_merit_badge_requirements')
      .select('requirement_number, is_header, parent_requirement_id, nesting_depth')
      .eq('merit_badge_id', badge.id)
      .eq('version_year', badge.requirement_version_year)
      .order('display_order')

    console.log(`\n${badgeName} v${badge.requirement_version_year}: ${reqs?.length || 0} requirements`)

    // Check for issues
    const issues: string[] = []

    // Check for orphaned children (have parent_id but parent doesn't exist)
    const reqIds = new Set(reqs?.map((r) => r.requirement_number) || [])
    for (const req of reqs || []) {
      if (req.parent_requirement_id) {
        // Get parent's requirement_number
        const parent = reqs?.find((r) => r.requirement_number === req.requirement_number.split('(')[0])
        if (!parent && req.nesting_depth > 0) {
          // More complex parent detection needed
        }
      }
    }

    // Check for headers without children
    const headers = reqs?.filter((r) => r.is_header) || []
    console.log(`  Headers: ${headers.length}`)
    console.log(`  Sample requirement numbers: ${reqs?.slice(0, 10).map((r) => r.requirement_number).join(', ')}`)

    // Show requirement 6 and 7 structure specifically
    const req6and7 = reqs?.filter((r) => r.requirement_number.startsWith('6') || r.requirement_number.startsWith('7')) || []
    console.log(`  Req 6-7 count: ${req6and7.length}`)
    if (req6and7.length > 0) {
      console.log(`  Req 6-7 numbers: ${req6and7.map((r) => r.requirement_number).join(', ')}`)
    }
  }
}

checkDatabase().catch(console.error)
