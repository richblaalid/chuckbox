#!/usr/bin/env npx tsx
/**
 * Rank Requirements Data Audit Script
 *
 * Audits the bsa_rank_requirements table for data quality issues:
 * - Duplicate requirements
 * - Missing sub_requirement_letters
 * - Orphaned child requirements
 * - Requirement count vs expected
 *
 * Usage: npx tsx scripts/audit-rank-requirements.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Detect --prod flag for environment switching
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

// Display which environment we're using
const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(`Missing environment variables. Ensure ${envFile} is configured.`)
  console.error('URL:', url ? 'set' : 'missing')
  console.error('KEY:', key ? 'set' : 'missing')
  process.exit(1)
}

const supabase = createClient(url, key)

// Expected requirement counts per rank (approximate based on BSA handbook)
const EXPECTED_COUNTS: Record<string, { min: number; max: number }> = {
  scout: { min: 15, max: 25 },
  tenderfoot: { min: 30, max: 45 },
  second_class: { min: 30, max: 45 },
  first_class: { min: 35, max: 50 },
  star: { min: 8, max: 15 },
  life: { min: 8, max: 15 },
  eagle: { min: 10, max: 20 },
}

interface Requirement {
  id: string
  requirement_number: string
  sub_requirement_letter: string | null
  parent_requirement_id: string | null
  description: string
  is_alternative: boolean | null
  alternatives_group: string | null
  display_order: number
}

interface AuditResult {
  rankCode: string
  rankName: string
  totalCount: number
  expectedRange: { min: number; max: number }
  countStatus: 'OK' | 'LOW' | 'HIGH'
  duplicates: Array<{
    key: string
    count: number
    descriptions: string[]
  }>
  missingSubLetters: Array<{
    id: string
    reqNum: string
    hasParent: boolean
    description: string
  }>
  orphanedChildren: Array<{
    id: string
    reqNum: string
    parentId: string
    description: string
  }>
  parentChildMismatches: Array<{
    parentReqNum: string
    childReqNum: string
    childSubLetter: string | null
  }>
}

async function auditRank(
  rankId: string,
  rankCode: string,
  rankName: string,
  versionId: string
): Promise<AuditResult> {
  const { data: requirements } = await supabase
    .from('bsa_rank_requirements')
    .select('*')
    .eq('rank_id', rankId)
    .eq('version_id', versionId)
    .order('display_order')

  const reqs = (requirements || []) as Requirement[]
  const reqMap = new Map(reqs.map(r => [r.id, r]))

  // Check for duplicates by requirement_number + sub_requirement_letter + description hash
  const duplicateMap = new Map<string, Requirement[]>()
  reqs.forEach(r => {
    // Key by number + sub_letter (if any) + first 50 chars of description
    const key = `${r.requirement_number}|${r.sub_requirement_letter || ''}|${r.description.slice(0, 50)}`
    if (!duplicateMap.has(key)) {
      duplicateMap.set(key, [])
    }
    duplicateMap.get(key)!.push(r)
  })

  const duplicates = Array.from(duplicateMap.entries())
    .filter(([_, items]) => items.length > 1)
    .map(([key, items]) => ({
      key: key.split('|').slice(0, 2).join(''),
      count: items.length,
      descriptions: items.map(i => i.description.slice(0, 40) + '...')
    }))

  // Check for missing sub_requirement_letters on child requirements
  const missingSubLetters = reqs
    .filter(r => r.parent_requirement_id && !r.sub_requirement_letter)
    .map(r => ({
      id: r.id,
      reqNum: r.requirement_number,
      hasParent: !!r.parent_requirement_id,
      description: r.description.slice(0, 50) + '...'
    }))

  // Check for orphaned children (parent_requirement_id doesn't exist)
  const orphanedChildren = reqs
    .filter(r => r.parent_requirement_id && !reqMap.has(r.parent_requirement_id))
    .map(r => ({
      id: r.id,
      reqNum: r.requirement_number,
      parentId: r.parent_requirement_id!,
      description: r.description.slice(0, 50) + '...'
    }))

  // Check for parent/child number mismatches (child's req_number should match parent's)
  const parentChildMismatches: Array<{
    parentReqNum: string
    childReqNum: string
    childSubLetter: string | null
  }> = []

  reqs.filter(r => r.parent_requirement_id).forEach(child => {
    const parent = reqMap.get(child.parent_requirement_id!)
    if (parent && child.requirement_number !== parent.requirement_number) {
      parentChildMismatches.push({
        parentReqNum: parent.requirement_number,
        childReqNum: child.requirement_number,
        childSubLetter: child.sub_requirement_letter
      })
    }
  })

  const expected = EXPECTED_COUNTS[rankCode] || { min: 10, max: 50 }
  let countStatus: 'OK' | 'LOW' | 'HIGH' = 'OK'
  if (reqs.length < expected.min) countStatus = 'LOW'
  else if (reqs.length > expected.max) countStatus = 'HIGH'

  return {
    rankCode,
    rankName,
    totalCount: reqs.length,
    expectedRange: expected,
    countStatus,
    duplicates,
    missingSubLetters,
    orphanedChildren,
    parentChildMismatches
  }
}

async function main() {
  console.log('=' .repeat(80))
  console.log('RANK REQUIREMENTS DATA AUDIT')
  console.log('=' .repeat(80))
  console.log()

  // Get active version
  const { data: version, error: versionError } = await supabase
    .from('bsa_requirement_versions')
    .select('id, version_year, effective_date, notes')
    .eq('is_active', true)
    .single()

  if (versionError || !version) {
    console.error('ERROR: No active requirement version found')
    console.error('Error details:', versionError)

    // Try to list all versions for debugging
    const { data: allVersions } = await supabase
      .from('bsa_requirement_versions')
      .select('*')
    console.error('Available versions:', allVersions)
    process.exit(1)
  }

  console.log('Active Version:', version.version_year, '(effective:', version.effective_date + ')')
  if (version.notes) console.log('Notes:', version.notes)
  console.log()

  // Get all ranks
  const { data: ranks } = await supabase
    .from('bsa_ranks')
    .select('id, code, name')
    .order('display_order')

  if (!ranks || ranks.length === 0) {
    console.error('ERROR: No ranks found')
    process.exit(1)
  }

  const results: AuditResult[] = []

  for (const rank of ranks) {
    const result = await auditRank(rank.id, rank.code, rank.name, version.id)
    results.push(result)
  }

  // Summary Table
  console.log('SUMMARY')
  console.log('-'.repeat(80))
  console.log(
    'Rank'.padEnd(15),
    'Count'.padStart(6),
    'Expected'.padStart(12),
    'Status'.padStart(8),
    'Dupes'.padStart(6),
    'Orphans'.padStart(8),
    'MissingSub'.padStart(11)
  )
  console.log('-'.repeat(80))

  let totalIssues = 0

  results.forEach(r => {
    const statusIcon = r.countStatus === 'OK' ? '✓' : r.countStatus === 'HIGH' ? '⚠️ HIGH' : '⚠️ LOW'
    const issueCount = r.duplicates.length + r.orphanedChildren.length + r.missingSubLetters.length
    totalIssues += issueCount

    console.log(
      r.rankName.padEnd(15),
      String(r.totalCount).padStart(6),
      `${r.expectedRange.min}-${r.expectedRange.max}`.padStart(12),
      statusIcon.padStart(8),
      String(r.duplicates.length).padStart(6),
      String(r.orphanedChildren.length).padStart(8),
      String(r.missingSubLetters.length).padStart(11)
    )
  })

  console.log('-'.repeat(80))
  console.log()

  // Detailed Issues
  if (totalIssues > 0) {
    console.log('DETAILED ISSUES')
    console.log('=' .repeat(80))

    results.forEach(r => {
      const hasIssues = r.duplicates.length > 0 ||
                        r.orphanedChildren.length > 0 ||
                        r.missingSubLetters.length > 0 ||
                        r.parentChildMismatches.length > 0

      if (!hasIssues) return

      console.log()
      console.log(`### ${r.rankName.toUpperCase()} (${r.rankCode})`)
      console.log()

      if (r.countStatus !== 'OK') {
        console.log(`  ⚠️  Count Issue: Has ${r.totalCount} requirements, expected ${r.expectedRange.min}-${r.expectedRange.max}`)
        console.log()
      }

      if (r.duplicates.length > 0) {
        console.log(`  📋 Duplicates (${r.duplicates.length} groups):`)
        r.duplicates.forEach(d => {
          console.log(`     [${d.key || 'no-key'}] appears ${d.count}x:`)
          d.descriptions.forEach(desc => {
            console.log(`        - ${desc}`)
          })
        })
        console.log()
      }

      if (r.orphanedChildren.length > 0) {
        console.log(`  🔗 Orphaned Children (${r.orphanedChildren.length}):`)
        r.orphanedChildren.forEach(o => {
          console.log(`     [${o.reqNum}] parent ${o.parentId} not found: ${o.description}`)
        })
        console.log()
      }

      if (r.missingSubLetters.length > 0) {
        console.log(`  🏷️  Missing Sub-Letters (${r.missingSubLetters.length}):`)
        r.missingSubLetters.forEach(m => {
          console.log(`     [${m.reqNum}] has parent but no sub_letter: ${m.description}`)
        })
        console.log()
      }

      if (r.parentChildMismatches.length > 0) {
        console.log(`  ⚡ Parent/Child Number Mismatches (${r.parentChildMismatches.length}):`)
        r.parentChildMismatches.forEach(m => {
          console.log(`     Parent [${m.parentReqNum}] has child [${m.childReqNum}${m.childSubLetter || ''}]`)
        })
        console.log()
      }
    })
  } else {
    console.log('✅ No issues found!')
  }

  // Final Summary
  console.log()
  console.log('=' .repeat(80))
  console.log('AUDIT COMPLETE')
  console.log()

  const totalReqs = results.reduce((sum, r) => sum + r.totalCount, 0)
  const totalDupes = results.reduce((sum, r) => sum + r.duplicates.length, 0)
  const ranksWithHighCount = results.filter(r => r.countStatus === 'HIGH').length

  console.log(`Total requirements across all ranks: ${totalReqs}`)
  console.log(`Ranks with count issues: ${ranksWithHighCount}`)
  console.log(`Total duplicate groups: ${totalDupes}`)

  if (ranksWithHighCount > 0) {
    console.log()
    console.log('⚠️  RECOMMENDATION: Data cleanup needed before display fixes will be effective.')
    console.log('   Run cleanup script or manually remove duplicates from affected ranks.')
  }
}

main().catch(err => {
  console.error('Audit failed:', err)
  process.exit(1)
})
