#!/usr/bin/env npx tsx
/**
 * Audit Merit Badge Requirements for Header Mismatches
 *
 * Finds requirements that should be headers but aren't marked as such,
 * and sub-requirements with incorrect parent relationships.
 *
 * Patterns detected:
 * 1. Requirements with "Do the following", "Discuss the following", etc.
 *    that aren't marked as headers
 * 2. Parenthetical sub-requirements (e.g., 4(1), 4(2)) whose parent
 *    should be a lettered requirement (e.g., 4a) but points elsewhere
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Phrases that indicate a requirement is actually a header/intro
const HEADER_PHRASES = [
  'do the following',
  'discuss the following',
  'complete the following',
  'explain the following',
  'describe the following',
  'demonstrate the following',
  'do all of the following',
  'do each of the following',
  'answer the following',
  'identify the following',
  'do one of the following',
  'do two of the following',
  'do three of the following',
  'choose one of the following',
  'choose two of the following',
]

interface Requirement {
  id: string
  requirement_number: string
  description: string
  is_header: boolean | null
  parent_requirement_id: string | null
  display_order: number
  merit_badge_id: string
  version_year: number
}

interface Badge {
  id: string
  name: string
}

interface Issue {
  badgeName: string
  versionYear: number
  requirementNumber: string
  issueType: 'should_be_header' | 'wrong_parent' | 'orphaned_sub'
  description: string
  details: string
}

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose') || args.includes('-v')
  const badgeFilter = args.find(a => a.startsWith('--badge='))?.split('=')[1]

  console.log('='.repeat(70))
  console.log('AUDIT: Merit Badge Requirement Header Mismatches')
  console.log('='.repeat(70))
  console.log('')

  // Get all badges
  let badgeQuery = supabase.from('bsa_merit_badges').select('id, name')
  if (badgeFilter) {
    badgeQuery = badgeQuery.ilike('name', `%${badgeFilter}%`)
  }
  const { data: badges } = await badgeQuery.order('name')

  if (!badges || badges.length === 0) {
    console.log('No badges found')
    return
  }

  console.log(`Scanning ${badges.length} badges...\n`)

  const allIssues: Issue[] = []

  for (const badge of badges) {
    // Get all requirements for this badge
    const { data: reqs } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, requirement_number, description, is_header, parent_requirement_id, display_order, merit_badge_id, version_year')
      .eq('merit_badge_id', badge.id)
      .order('version_year')
      .order('display_order')

    if (!reqs || reqs.length === 0) continue

    // Group by version year
    const byYear = new Map<number, Requirement[]>()
    for (const req of reqs) {
      const year = req.version_year || 0
      if (!byYear.has(year)) byYear.set(year, [])
      byYear.get(year)!.push(req as Requirement)
    }

    for (const [year, yearReqs] of byYear) {
      const issues = findIssues(badge.name, year, yearReqs)
      allIssues.push(...issues)
    }
  }

  // Print summary
  console.log('='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log('')

  if (allIssues.length === 0) {
    console.log('No issues found!')
    return
  }

  // Group by badge
  const byBadge = new Map<string, Issue[]>()
  for (const issue of allIssues) {
    const key = `${issue.badgeName} (${issue.versionYear})`
    if (!byBadge.has(key)) byBadge.set(key, [])
    byBadge.get(key)!.push(issue)
  }

  // Count by issue type
  const shouldBeHeader = allIssues.filter(i => i.issueType === 'should_be_header').length
  const wrongParent = allIssues.filter(i => i.issueType === 'wrong_parent').length
  const orphanedSub = allIssues.filter(i => i.issueType === 'orphaned_sub').length

  console.log(`Total issues found: ${allIssues.length}`)
  console.log(`  - Should be header: ${shouldBeHeader}`)
  console.log(`  - Wrong parent: ${wrongParent}`)
  console.log(`  - Orphaned sub-requirements: ${orphanedSub}`)
  console.log('')
  console.log(`Badges affected: ${byBadge.size}`)
  console.log('')

  // Print details
  for (const [badgeKey, issues] of Array.from(byBadge.entries()).sort()) {
    console.log(`\n${badgeKey}:`)
    for (const issue of issues) {
      const typeLabel = {
        'should_be_header': '[HEADER?]',
        'wrong_parent': '[PARENT]',
        'orphaned_sub': '[ORPHAN]',
      }[issue.issueType]

      console.log(`  ${typeLabel} ${issue.requirementNumber}: ${issue.details}`)
      if (verbose) {
        console.log(`           Desc: "${issue.description.substring(0, 60)}..."`)
      }
    }
  }

  console.log('\n')
  console.log('Run with --verbose for more details')
  console.log('Run with --badge=<name> to filter to specific badge')
}

function findIssues(badgeName: string, year: number, reqs: Requirement[]): Issue[] {
  const issues: Issue[] = []
  const reqMap = new Map(reqs.map(r => [r.id, r]))
  const reqByNumber = new Map(reqs.map(r => [r.requirement_number, r]))
  // Case-insensitive lookup map
  const reqByNumberUpper = new Map(reqs.map(r => [r.requirement_number.toUpperCase(), r]))

  for (const req of reqs) {
    // Issue 1: Should be a header but isn't
    if (!req.is_header) {
      const descLower = (req.description || '').toLowerCase()
      for (const phrase of HEADER_PHRASES) {
        if (descLower.includes(phrase)) {
          // Check if there are likely sub-requirements
          const hasLikelySubs = reqs.some(r => {
            // Look for parenthetical subs like 4(1) when this is 4a
            const match = req.requirement_number.match(/^(\d+)([a-z])$/i)
            if (match) {
              const base = match[1]
              // Check for patterns like 4(1), 4(2) or 4a(1), 4a(2)
              return r.requirement_number.match(new RegExp(`^${base}\\([0-9]+\\)$`)) ||
                     r.requirement_number.match(new RegExp(`^${base}${match[2]}\\([0-9]+\\)$`, 'i'))
            }
            return false
          })

          issues.push({
            badgeName,
            versionYear: year,
            requirementNumber: req.requirement_number,
            issueType: 'should_be_header',
            description: req.description,
            details: `Contains "${phrase}" but is_header=false`,
          })
          break
        }
      }
    }

    // Issue 2: Parenthetical sub-requirement with potentially wrong parent
    // Pattern: 4(1), 4(2) should have parent 4a if 4a exists and looks like a header
    const parenMatch = req.requirement_number.match(/^(\d+)\((\d+)\)$/)
    if (parenMatch) {
      const baseNum = parenMatch[1]

      // Find potential parent candidates (e.g., 4a, 4b for base 4)
      const potentialParents = reqs.filter(r => {
        const letterMatch = r.requirement_number.match(new RegExp(`^${baseNum}([a-z])$`, 'i'))
        if (letterMatch) {
          // Check if this looks like a header (has header phrase or is marked as header)
          const descLower = (r.description || '').toLowerCase()
          return r.is_header || HEADER_PHRASES.some(p => descLower.includes(p))
        }
        return false
      })

      if (potentialParents.length > 0) {
        // There's a lettered requirement that looks like a header
        // Check if current parent is correct
        const currentParent = req.parent_requirement_id ? reqMap.get(req.parent_requirement_id) : null
        const currentParentNum = currentParent?.requirement_number || '(none)'

        // The first potential parent (by display order) is likely the correct one
        const likelyParent = potentialParents.sort((a, b) => a.display_order - b.display_order)[0]

        if (req.parent_requirement_id !== likelyParent.id) {
          issues.push({
            badgeName,
            versionYear: year,
            requirementNumber: req.requirement_number,
            issueType: 'wrong_parent',
            description: req.description,
            details: `Parent is "${currentParentNum}", should likely be "${likelyParent.requirement_number}"`,
          })
        }
      }
    }

    // Issue 3: Lettered sub with parenthetical that doesn't exist
    // Pattern: 4a(1) where 4a doesn't exist or isn't the parent
    const letterParenMatch = req.requirement_number.match(/^(\d+)([a-z])\((\d+)\)$/i)
    if (letterParenMatch) {
      const baseWithLetter = letterParenMatch[1] + letterParenMatch[2]
      const expectedParent = reqByNumberUpper.get(baseWithLetter.toUpperCase())

      if (!expectedParent) {
        issues.push({
          badgeName,
          versionYear: year,
          requirementNumber: req.requirement_number,
          issueType: 'orphaned_sub',
          description: req.description,
          details: `Expected parent "${baseWithLetter}" doesn't exist`,
        })
      } else if (req.parent_requirement_id !== expectedParent.id) {
        const currentParent = req.parent_requirement_id ? reqMap.get(req.parent_requirement_id) : null
        // Skip if parent numbers match (handles duplicate requirement IDs)
        if (currentParent?.requirement_number.toUpperCase() !== baseWithLetter.toUpperCase()) {
          issues.push({
            badgeName,
            versionYear: year,
            requirementNumber: req.requirement_number,
            issueType: 'wrong_parent',
            description: req.description,
            details: `Parent is "${currentParent?.requirement_number || '(none)'}", should be "${baseWithLetter}"`,
          })
        }
      }
    }
  }

  return issues
}

main().catch(console.error)
