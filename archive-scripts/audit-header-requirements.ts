#!/usr/bin/env npx tsx
/**
 * Audit Header Requirements
 *
 * Identifies requirements that appear to be "headers" rather than approvable requirements:
 * - They have child requirements (are parents)
 * - Their description matches header patterns like "Do the following:"
 *
 * Reports findings without making changes.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Patterns that indicate a header rather than an approvable requirement
const HEADER_PATTERNS = [
  /^do the following:?$/i,
  /^do one of the following:?$/i,
  /^do two of the following:?$/i,
  /^do three of the following:?$/i,
  /^complete .* of the following:?$/i,
  /^choose .* of the following:?$/i,
  /^select .* of the following:?$/i,
  /^with your .* do the following:?$/i,
  /^for .* do the following:?$/i,
  /^do all of the following:?$/i,
  /^do each of the following:?$/i,
  /^do both of the following:?$/i,
  /^do either of the following:?$/i,
  /^earn .* of the following:?$/i,
  /^while a .* do the following:?$/i,
  /^using .* do the following:?$/i,
  /^before you .* do the following:?$/i,
  /^demonstrate .* of the following:?$/i,
  /^explain .* of the following:?$/i,
  /^show or demonstrate the following:?$/i,
]

interface AuditResult {
  id: string
  badgeName: string
  versionYear: number
  requirementNumber: string
  description: string
  childCount: number
  hasProgress: boolean
  progressCount: number
  matchedPattern: string | null
}

async function fetchAllBsaRequirements() {
  const allReqs: any[] = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select(`
        id,
        requirement_number,
        description,
        parent_requirement_id,
        merit_badge_id,
        version_year,
        bsa_merit_badges(name)
      `)
      .range(offset, offset + batchSize - 1)
      .order('id')

    if (error || !data || data.length === 0) break
    allReqs.push(...data)
    offset += batchSize
    if (data.length < batchSize) break
  }

  return allReqs
}

async function auditBsaTables(): Promise<AuditResult[]> {
  console.log('\n' + '='.repeat(60))
  console.log('AUDITING BSA TABLES')
  console.log('='.repeat(60))

  // Get all requirements that have children
  const allReqs = await fetchAllBsaRequirements()

  if (!allReqs) {
    console.log('No requirements found')
    return []
  }

  // Find requirements that are parents (have children pointing to them)
  const parentIds = new Set<string>()
  const childCounts = new Map<string, number>()

  for (const req of allReqs) {
    if (req.parent_requirement_id) {
      parentIds.add(req.parent_requirement_id)
      childCounts.set(
        req.parent_requirement_id,
        (childCounts.get(req.parent_requirement_id) || 0) + 1
      )
    }
  }

  console.log(`Total requirements: ${allReqs.length}`)
  console.log(`Requirements with children: ${parentIds.size}`)

  // Get progress counts for parent requirements
  const { data: progressData } = await supabase
    .from('scout_merit_badge_requirement_progress')
    .select('requirement_id')

  const progressCounts = new Map<string, number>()
  for (const p of progressData || []) {
    progressCounts.set(p.requirement_id, (progressCounts.get(p.requirement_id) || 0) + 1)
  }

  // Analyze parent requirements
  const results: AuditResult[] = []
  let headerCount = 0
  let headerWithProgress = 0

  for (const req of allReqs) {
    if (!parentIds.has(req.id)) continue

    const desc = (req.description || '').trim()
    let matchedPattern: string | null = null

    for (const pattern of HEADER_PATTERNS) {
      if (pattern.test(desc)) {
        matchedPattern = pattern.source
        break
      }
    }

    const childCount = childCounts.get(req.id) || 0
    const progressCount = progressCounts.get(req.id) || 0

    if (matchedPattern) {
      headerCount++
      if (progressCount > 0) headerWithProgress++

      results.push({
        id: req.id,
        badgeName: (req.bsa_merit_badges as unknown as { name: string })?.name || 'Unknown',
        versionYear: req.version_year || 0,
        requirementNumber: req.requirement_number,
        description: desc,
        childCount,
        hasProgress: progressCount > 0,
        progressCount,
        matchedPattern,
      })
    }
  }

  console.log(`\nIdentified headers (has children + matches pattern): ${headerCount}`)
  console.log(`Headers with existing progress records: ${headerWithProgress}`)

  return results
}

async function fetchAllNewRequirements() {
  const allReqs: any[] = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('merit_badge_requirements')
      .select(`
        id,
        scoutbook_id,
        description,
        parent_id,
        is_header,
        badge_version_id,
        merit_badge_versions(badge_name, version_year)
      `)
      .range(offset, offset + batchSize - 1)
      .order('id')

    if (error || !data || data.length === 0) break
    allReqs.push(...data)
    offset += batchSize
    if (data.length < batchSize) break
  }

  return allReqs
}

async function auditNewTables(): Promise<AuditResult[]> {
  console.log('\n' + '='.repeat(60))
  console.log('AUDITING NEW MERIT_BADGE TABLES')
  console.log('='.repeat(60))

  // Get all requirements
  const allReqs = await fetchAllNewRequirements()

  if (!allReqs) {
    console.log('No requirements found')
    return []
  }

  // Find requirements that are parents
  const parentIds = new Set<string>()
  const childCounts = new Map<string, number>()

  for (const req of allReqs) {
    if (req.parent_id) {
      parentIds.add(req.parent_id)
      childCounts.set(req.parent_id, (childCounts.get(req.parent_id) || 0) + 1)
    }
  }

  console.log(`Total requirements: ${allReqs.length}`)
  console.log(`Requirements with children: ${parentIds.size}`)

  // Check how many are already marked as headers
  const alreadyMarkedHeaders = allReqs.filter((r) => r.is_header).length
  console.log(`Already marked as is_header=true: ${alreadyMarkedHeaders}`)

  // Analyze parent requirements
  const results: AuditResult[] = []
  let headerCount = 0

  for (const req of allReqs) {
    if (!parentIds.has(req.id)) continue

    const desc = (req.description || '').trim()
    let matchedPattern: string | null = null

    for (const pattern of HEADER_PATTERNS) {
      if (pattern.test(desc)) {
        matchedPattern = pattern.source
        break
      }
    }

    const childCount = childCounts.get(req.id) || 0
    const version = req.merit_badge_versions as { badge_name: string; version_year: number }

    if (matchedPattern) {
      headerCount++

      results.push({
        id: req.id,
        badgeName: version?.badge_name || 'Unknown',
        versionYear: version?.version_year || 0,
        requirementNumber: req.scoutbook_id,
        description: desc,
        childCount,
        hasProgress: false, // New tables don't have progress tracking yet
        progressCount: 0,
        matchedPattern,
      })
    }
  }

  console.log(`\nIdentified headers (has children + matches pattern): ${headerCount}`)

  return results
}

async function main() {
  console.log('REQUIREMENT HEADER AUDIT')
  console.log('========================')
  console.log('Identifying requirements that are headers rather than approvable items')
  console.log('Criteria: Has child requirements AND description matches header patterns')

  // Audit both table sets
  const bsaResults = await auditBsaTables()
  const newResults = await auditNewTables()

  // Summary report
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY REPORT')
  console.log('='.repeat(60))

  console.log('\nBSA Tables:')
  console.log(`  Total identified headers: ${bsaResults.length}`)
  console.log(`  Headers with progress records: ${bsaResults.filter((r) => r.hasProgress).length}`)
  console.log(
    `  Total progress records affected: ${bsaResults.reduce((sum, r) => sum + r.progressCount, 0)}`
  )

  console.log('\nNew Tables:')
  console.log(`  Total identified headers: ${newResults.length}`)

  // Show sample headers by description pattern
  console.log('\n' + '='.repeat(60))
  console.log('SAMPLE HEADERS BY PATTERN')
  console.log('='.repeat(60))

  const byPattern = new Map<string, AuditResult[]>()
  for (const r of [...bsaResults, ...newResults]) {
    if (r.matchedPattern) {
      const existing = byPattern.get(r.matchedPattern) || []
      existing.push(r)
      byPattern.set(r.matchedPattern, existing)
    }
  }

  for (const [pattern, results] of byPattern) {
    console.log(`\nPattern: ${pattern}`)
    console.log(`  Count: ${results.length}`)
    const sample = results.slice(0, 3)
    for (const r of sample) {
      console.log(`  - ${r.badgeName} ${r.versionYear} req ${r.requirementNumber}: "${r.description}"`)
    }
  }

  // Show non-matching parents (might need manual review)
  console.log('\n' + '='.repeat(60))
  console.log('PARENT REQUIREMENTS NOT MATCHING PATTERNS (may need review)')
  console.log('='.repeat(60))

  // Re-check for non-matching parents in BSA tables
  const allBsaReqs = await fetchAllBsaRequirements()

  const bsaParentIds = new Set<string>()
  for (const req of allBsaReqs || []) {
    if (req.parent_requirement_id) {
      bsaParentIds.add(req.parent_requirement_id)
    }
  }

  const matchedIds = new Set(bsaResults.map((r) => r.id))
  const nonMatchingParents: Array<{
    badge: string
    year: number
    req: string
    desc: string
  }> = []

  for (const req of allBsaReqs || []) {
    if (bsaParentIds.has(req.id) && !matchedIds.has(req.id)) {
      nonMatchingParents.push({
        badge: (req.bsa_merit_badges as unknown as { name: string })?.name || 'Unknown',
        year: req.version_year || 0,
        req: req.requirement_number,
        desc: (req.description || '').substring(0, 80),
      })
    }
  }

  console.log(`\nParents not matching header patterns: ${nonMatchingParents.length}`)
  console.log('Sample (first 20):')
  for (const p of nonMatchingParents.slice(0, 20)) {
    console.log(`  ${p.badge} ${p.year} req ${p.req}: "${p.desc}..."`)
  }

  // Progress impact details
  if (bsaResults.some((r) => r.hasProgress)) {
    console.log('\n' + '='.repeat(60))
    console.log('PROGRESS RECORDS IMPACT DETAIL')
    console.log('='.repeat(60))

    const withProgress = bsaResults.filter((r) => r.hasProgress)
    console.log(`\n${withProgress.length} headers have progress records:`)
    for (const r of withProgress.slice(0, 20)) {
      console.log(`  ${r.badgeName} ${r.versionYear} req ${r.requirementNumber}: ${r.progressCount} records`)
    }
    if (withProgress.length > 20) {
      console.log(`  ... and ${withProgress.length - 20} more`)
    }
  }
}

main().catch(console.error)
