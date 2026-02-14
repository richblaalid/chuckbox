#!/usr/bin/env npx tsx
/**
 * Test Troop Advancement Import
 *
 * Tests the full import flow using the sample CSV file.
 * Bypasses authentication by using service role key directly.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Import the parser (doesn't need request context)
import { parseTroopAdvancementCSV } from '../src/lib/import/scoutbook-troop-advancement-parser'

async function test() {
  console.log('='.repeat(60))
  console.log('TEST: Troop Advancement Import')
  console.log('='.repeat(60))
  console.log('')

  // Get unit ID
  const { data: unit } = await supabase
    .from('units')
    .select('id, name')
    .single()

  if (!unit) {
    console.error('No unit found in database')
    process.exit(1)
  }

  console.log(`Unit: ${unit.name} (${unit.id})`)

  // Load CSV file
  const csvPath = path.join(process.cwd(), 'docs/troop_advancement/Troop9297B_Advancement_20260124added.csv')
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`)
    process.exit(1)
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8')
  console.log(`CSV file: ${csvPath}`)
  console.log(`CSV size: ${(csvContent.length / 1024).toFixed(1)} KB`)
  console.log('')

  // Parse the CSV
  console.log('Parsing CSV...')
  const parsed = parseTroopAdvancementCSV(csvContent)

  console.log('Parse Results:')
  console.log(`  Total rows: ${parsed.summary.totalRows}`)
  console.log(`  Scouts: ${parsed.summary.scoutCount}`)
  console.log(`  Ranks: ${parsed.summary.rankCount}`)
  console.log(`  Rank Requirements: ${parsed.summary.rankRequirementCount}`)
  console.log(`  Badges: ${parsed.summary.badgeCount}`)
  console.log(`  Badge Requirements: ${parsed.summary.badgeRequirementCount}`)
  console.log('')

  if (parsed.errors.length > 0) {
    console.log('Parse Errors:')
    parsed.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`))
    if (parsed.errors.length > 10) {
      console.log(`  ... and ${parsed.errors.length - 10} more`)
    }
    console.log('')
  }

  // Show sample scout data
  const scoutIds = [...parsed.scouts.keys()]
  console.log(`Sample scouts (first 5 of ${scoutIds.length}):`)
  scoutIds.slice(0, 5).forEach(id => {
    const scout = parsed.scouts.get(id)!
    console.log(`  - ${scout.firstName} ${scout.lastName} (BSA: ${id})`)
    console.log(`    Ranks: ${scout.ranks.length}, Badges: ${scout.meritBadges.length}`)
    console.log(`    Rank Reqs: ${scout.rankRequirements.length}, Badge Reqs: ${scout.meritBadgeRequirements.length}`)
  })
  console.log('')

  // Match scouts to database
  console.log('Matching scouts to database...')
  const { data: dbScouts } = await supabase
    .from('scouts')
    .select('id, bsa_member_id, first_name, last_name')
    .eq('unit_id', unit.id)

  const scoutsByBsaId = new Map(dbScouts?.map(s => [s.bsa_member_id, s]) || [])

  let matched = 0
  let unmatched = 0
  const unmatchedScouts: string[] = []

  for (const bsaId of scoutIds) {
    if (scoutsByBsaId.has(bsaId)) {
      matched++
    } else {
      unmatched++
      const scout = parsed.scouts.get(bsaId)!
      unmatchedScouts.push(`${scout.firstName} ${scout.lastName} (${bsaId})`)
    }
  }

  console.log(`  Matched: ${matched}`)
  console.log(`  Unmatched (will be created): ${unmatched}`)
  if (unmatchedScouts.length > 0) {
    console.log('  Sample unmatched:')
    unmatchedScouts.slice(0, 5).forEach(s => console.log(`    - ${s}`))
  }
  console.log('')

  // Check badge matching
  console.log('Checking badge requirement matching...')

  // Get all badges
  const { data: badges } = await supabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')

  // Normalize badge names the same way the parser does
  const normalizeName = (name: string) =>
    name.toLowerCase()
      .replace(/\s+mb$/i, '')
      .replace(/\s+merit\s+badge$/i, '')
      .replace(/\s*&\s*/g, ' and ') // Normalize & to "and" before other processing
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')

  const badgeByNormalizedName = new Map(badges?.map(b => [normalizeName(b.name), b]) || [])

  // Get all requirements with scoutbook IDs (paginate to get all 11k+ records)
  console.log('Loading requirements (paginated)...')
  const requirements: Array<{
    id: string
    merit_badge_id: string
    version_year: number
    requirement_number: string
    scoutbook_requirement_number: string | null
    is_header: boolean
  }> = []

  const PAGE_SIZE = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, version_year, requirement_number, scoutbook_requirement_number, is_header')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching requirements:', error)
      break
    }

    if (batch && batch.length > 0) {
      requirements.push(...batch)
      offset += batch.length
      if (batch.length < PAGE_SIZE) {
        hasMore = false
      }
    } else {
      hasMore = false
    }
  }

  console.log(`  Loaded ${requirements.length} requirements`)

  // No normalization needed - Scoutbook IDs should match exactly
  // The canonical data uses Scoutbook's exact requirement IDs
  const normalizeReqNumber = (num: string) => num

  // Build lookup map: badgeId:versionYear:scoutbookId -> requirement
  type RequirementRecord = (typeof requirements)[0]
  const reqByScoutbookId = new Map<string, RequirementRecord>()
  const reqByReqNumber = new Map<string, RequirementRecord>()

  for (const req of requirements || []) {
    if (req.scoutbook_requirement_number) {
      // Use exact scoutbook_requirement_number as key
      const key = `${req.merit_badge_id}:${req.version_year}:${req.scoutbook_requirement_number}`
      reqByScoutbookId.set(key, req)
    }
    const numKey = `${req.merit_badge_id}:${req.version_year}:${req.requirement_number}`
    reqByReqNumber.set(numKey, req)
  }

  // Test matching for first scout with badge requirements
  let testScout = null
  for (const bsaId of scoutIds) {
    const scout = parsed.scouts.get(bsaId)!
    if (scout.meritBadgeRequirements.length > 0) {
      testScout = scout
      break
    }
  }

  if (testScout) {
    console.log(`\nTesting requirement matching for: ${testScout.firstName} ${testScout.lastName}`)

    // Test ALL badge requirements for this scout
    const allReqs = testScout.meritBadgeRequirements
    let matchedReqs = 0
    let unmatchedReqs = 0
    let headerMatches = 0
    const unmatchedExamples: string[] = []

    for (const req of allReqs) {
      // Use the normalizedName from the parser (already normalized)
      const badge = badgeByNormalizedName.get(req.normalizedName)
      if (!badge) {
        unmatchedReqs++
        if (unmatchedExamples.length < 5) {
          unmatchedExamples.push(`Badge not found: ${req.badgeName} (${req.normalizedName})`)
        }
        continue
      }

      const version = req.version ? parseInt(req.version, 10) : badge.requirement_version_year

      // Try exact match first (Scoutbook IDs should match exactly now)
      const normalizedReqNum = normalizeReqNumber(req.requirementNumber)
      const scoutbookKey = `${badge.id}:${version}:${normalizedReqNum}`
      let dbReq = reqByScoutbookId.get(scoutbookKey)

      // Fallback to requirement number
      if (!dbReq) {
        const numKey = `${badge.id}:${version}:${normalizedReqNum}`
        dbReq = reqByReqNumber.get(numKey)
      }

      if (dbReq) {
        matchedReqs++
        if (dbReq.is_header) {
          headerMatches++
        }
      } else {
        unmatchedReqs++
        if (unmatchedExamples.length < 5) {
          unmatchedExamples.push(`${req.badgeName} ${req.requirementNumber} (v${version})`)
        }
      }
    }

    console.log(`  Badge Requirements: ${matchedReqs} matched, ${unmatchedReqs} unmatched`)
    if (headerMatches > 0) {
      console.log(`  WARNING: ${headerMatches} requirements matched to headers`)
    }
    if (unmatchedExamples.length > 0) {
      console.log('  Unmatched examples:')
      unmatchedExamples.forEach(e => console.log(`    - ${e}`))
    }
  }

  // Test rank requirements matching
  console.log('\nTesting rank requirement matching...')

  // Get all ranks
  const { data: ranks } = await supabase
    .from('bsa_ranks')
    .select('id, name, code')

  const rankByCode = new Map(ranks?.map(r => [r.code, r]) || [])
  const rankByName = new Map(ranks?.map(r => [r.name.toLowerCase(), r]) || [])

  // Get all rank requirements (paginated)
  const rankRequirements: Array<{
    id: string
    rank_id: string
    requirement_number: string
  }> = []

  offset = 0
  hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .from('bsa_rank_requirements')
      .select('id, rank_id, requirement_number')
      .range(offset, offset + PAGE_SIZE - 1)

    if (batch && batch.length > 0) {
      rankRequirements.push(...batch)
      offset += batch.length
      if (batch.length < PAGE_SIZE) hasMore = false
    } else {
      hasMore = false
    }
  }

  console.log(`  Loaded ${rankRequirements.length} rank requirements`)

  // Build lookup map
  const rankReqByKey = new Map<string, (typeof rankRequirements)[0]>()
  for (const req of rankRequirements) {
    const key = `${req.rank_id}:${req.requirement_number}`
    rankReqByKey.set(key, req)
  }

  // Test with first scout that has rank requirements
  if (testScout && testScout.rankRequirements.length > 0) {
    let matchedRankReqs = 0
    let unmatchedRankReqs = 0
    const unmatchedRankExamples: string[] = []

    for (const req of testScout.rankRequirements) {
      // Find the rank using rankCode from parsed data
      const rank = rankByCode.get(req.rankCode)

      if (!rank) {
        unmatchedRankReqs++
        if (unmatchedRankExamples.length < 5) {
          unmatchedRankExamples.push(`Rank not found: ${req.rankCode}`)
        }
        continue
      }

      const key = `${rank.id}:${req.requirementNumber}`
      const dbReq = rankReqByKey.get(key)

      if (dbReq) {
        matchedRankReqs++
      } else {
        unmatchedRankReqs++
        if (unmatchedRankExamples.length < 5) {
          unmatchedRankExamples.push(`${req.rankCode} ${req.requirementNumber}`)
        }
      }
    }

    console.log(`  Rank Requirements: ${matchedRankReqs} matched, ${unmatchedRankReqs} unmatched`)
    if (unmatchedRankExamples.length > 0) {
      console.log('  Unmatched examples:')
      unmatchedRankExamples.forEach(e => console.log(`    - ${e}`))
    }
  }

  // Test ALL scouts for overall matching statistics
  console.log('\nOverall matching statistics across all scouts:')
  let totalBadgeReqMatched = 0
  let totalBadgeReqUnmatched = 0
  let totalRankReqMatched = 0
  let totalRankReqUnmatched = 0
  const unmatchedBadgeReqs = new Map<string, number>() // Track unique unmatched patterns

  for (const bsaId of scoutIds) {
    const scout = parsed.scouts.get(bsaId)!

    // Badge requirements
    for (const req of scout.meritBadgeRequirements) {
      const badge = badgeByNormalizedName.get(req.normalizedName)
      if (!badge) {
        totalBadgeReqUnmatched++
        const key = `Badge: ${req.badgeName}`
        unmatchedBadgeReqs.set(key, (unmatchedBadgeReqs.get(key) || 0) + 1)
        continue
      }

      const version = req.version ? parseInt(req.version, 10) : badge.requirement_version_year
      const normalizedReqNum = normalizeReqNumber(req.requirementNumber)
      const scoutbookKey = `${badge.id}:${version}:${normalizedReqNum}`
      let dbReq = reqByScoutbookId.get(scoutbookKey)

      if (!dbReq) {
        const numKey = `${badge.id}:${version}:${normalizedReqNum}`
        dbReq = reqByReqNumber.get(numKey)
      }

      if (dbReq) {
        totalBadgeReqMatched++
      } else {
        totalBadgeReqUnmatched++
        const key = `${req.badgeName} v${version} ${req.requirementNumber}`
        unmatchedBadgeReqs.set(key, (unmatchedBadgeReqs.get(key) || 0) + 1)
      }
    }

    // Rank requirements
    for (const req of scout.rankRequirements) {
      const rank = rankByCode.get(req.rankCode)
      if (!rank) {
        totalRankReqUnmatched++
        continue
      }

      const key = `${rank.id}:${req.requirementNumber}`
      const dbReq = rankReqByKey.get(key)
      if (dbReq) {
        totalRankReqMatched++
      } else {
        totalRankReqUnmatched++
      }
    }
  }

  const badgeReqMatchRate = (totalBadgeReqMatched / (totalBadgeReqMatched + totalBadgeReqUnmatched) * 100).toFixed(1)
  const rankReqMatchRate = (totalRankReqMatched / (totalRankReqMatched + totalRankReqUnmatched) * 100).toFixed(1)

  console.log(`  Badge Requirements: ${totalBadgeReqMatched} matched, ${totalBadgeReqUnmatched} unmatched (${badgeReqMatchRate}% match rate)`)
  console.log(`  Rank Requirements: ${totalRankReqMatched} matched, ${totalRankReqUnmatched} unmatched (${rankReqMatchRate}% match rate)`)

  // Show top unmatched patterns
  const topUnmatched = [...unmatchedBadgeReqs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  if (topUnmatched.length > 0) {
    console.log('\n  Top unmatched badge requirement patterns:')
    topUnmatched.forEach(([pattern, count]) => {
      console.log(`    ${count}x - ${pattern}`)
    })
  }

  // Check is_header distribution
  const { count: headerCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .eq('is_header', true)

  const { count: nonHeaderCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .eq('is_header', false)

  console.log(`\nDatabase header distribution:`)
  console.log(`  Headers (is_header=true): ${headerCount}`)
  console.log(`  Non-headers (is_header=false): ${nonHeaderCount}`)

  console.log('')
  console.log('='.repeat(60))
  console.log('PARSE TEST COMPLETE')
  console.log('='.repeat(60))
  console.log('')
  console.log('To test full import, use the UI at:')
  console.log('  http://localhost:3000/settings (Data tab → Import Troop Advancement)')
}

test().catch(console.error)
