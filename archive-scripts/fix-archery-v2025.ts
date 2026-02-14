#!/usr/bin/env npx tsx

/**
 * Fix Archery v2025 source data structure
 *
 * The scraped data has confusing naming:
 * - 5A* = Option A main requirements (5A(1) through 5A(6))
 * - 5B* = Option A's 5A(6)(a) children
 * - 5Aa = Should be 5A(6)(a), 5Bb = Should be 5A(6)(b)
 * - 5C* = Option B main requirements (5B(1) through 5B(6))
 * - 5D* = Option B's 5B(6)(a) children
 * - 5Ca = Should be 5B(6)(a), 5Db = Should be 5B(6)(b)
 *
 * Target structure:
 * 5 [H]
 * ├── 5A [H] (Option A - Recurve Bow or Longbow)
 * │   ├── 5A(1) through 5A(5)
 * │   └── 5A(6) [H]
 * │       ├── 5A(6)(a) [H]
 * │       │   ├── 5A(6)(a)(1) through 5A(6)(a)(4)
 * │       └── 5A(6)(b)
 * └── 5B [H] (Option B - Compound Bow)
 *     ├── 5B(1) through 5B(5)
 *     └── 5B(6) [H]
 *         ├── 5B(6)(a) [H]
 *         │   ├── 5B(6)(a)(1) through 5B(6)(a)(4)
 *         └── 5B(6)(b)
 *
 * PRESERVES: All scoutbook_id values unchanged
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CANONICAL_PATH = path.join(__dirname, '../data/bsa-data-canonical.json')

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  nesting_depth: number
  display_order: number
  children: Requirement[]
}

interface BadgeVersion {
  version_year: number
  is_estimated?: boolean
  requirements: Requirement[]
}

interface Badge {
  name: string
  code?: string
  category: string
  description?: string | null
  is_eagle_required?: boolean
  is_active?: boolean
  image_url: string
  requirement_version_year?: number
  versions: BadgeVersion[]
}

interface CanonicalData {
  generated?: string
  source?: string
  merit_badges: Badge[]
  ranks?: unknown[]
}

function recalculateDisplayOrder(reqs: Requirement[], startOrder: number = 1): number {
  let order = startOrder
  for (const req of reqs) {
    req.display_order = order++
    if (req.children && req.children.length > 0) {
      order = recalculateDisplayOrder(req.children, order)
    }
  }
  return order
}

function recalculateNestingDepth(reqs: Requirement[], depth: number = 1): void {
  for (const req of reqs) {
    req.nesting_depth = depth
    if (req.children && req.children.length > 0) {
      recalculateNestingDepth(req.children, depth + 1)
    }
  }
}

function createRequirement(number: string, scoutbookId: string, description: string, isHeader: boolean = false): Requirement {
  return {
    requirement_number: number,
    scoutbook_id: scoutbookId,
    description: description,
    is_header: isHeader,
    nesting_depth: 0,
    display_order: 0,
    children: []
  }
}

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  // Find Archery badge
  const archery = data.merit_badges.find(b => b.name === 'Archery')
  if (!archery) {
    console.error('Archery badge not found')
    process.exit(1)
  }

  // Find v2025
  const v2025 = archery.versions.find(v => v.version_year === 2025)
  if (!v2025) {
    console.error('Archery v2025 not found')
    process.exit(1)
  }

  console.log('Found Archery v2025 with', v2025.requirements.length, 'top-level requirements')

  // Get requirement 5
  const req5 = v2025.requirements.find(r => r.requirement_number === '5')
  if (!req5) {
    console.error('Requirement 5 not found')
    process.exit(1)
  }

  // Load scraped data to get all sub-requirements
  const scrapedData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/merit-badge-requirements-scraped.json'), 'utf-8'))

  // Find Archery 2025 in scraped data
  let scrapedV2025 = null
  for (const key of Object.keys(scrapedData.badges)) {
    const b = scrapedData.badges[key]
    if (b.badgeName === 'Archery' && b.versionYear === 2025) {
      scrapedV2025 = b
      break
    }
  }

  if (!scrapedV2025) {
    console.error('Archery 2025 not found in scraped data')
    process.exit(1)
  }

  console.log('Found', scrapedV2025.requirements.length, 'requirements in scraped data')

  // Build a map of all scraped requirements by number
  const scrapedReqs = new Map<string, { number: string; description: string; parent: string | null; depth: number }>()
  for (const r of scrapedV2025.requirements) {
    scrapedReqs.set(r.number, { number: r.number, description: r.description, parent: r.parentNumber, depth: r.depth })
  }

  // Build the new structure for requirement 5
  console.log('\nBuilding new structure for requirement 5...')

  // Create Option A header
  const optionA = createRequirement(
    '5A',
    '5 Option A',
    'Option A — Using a Recurve Bow or Longbow. Do ALL of the following:',
    true
  )

  // Add 5A(1) through 5A(5) from scraped data
  for (let i = 1; i <= 5; i++) {
    const scraped = scrapedReqs.get(`5A(${i})`)
    if (scraped) {
      optionA.children.push(createRequirement(
        `5A(${i})`,
        `5A(${i})`,
        scraped.description,
        false
      ))
    }
  }

  // Create 5A(6) header
  const scraped5A6 = scrapedReqs.get('5A(6)')
  const req5A6 = createRequirement(
    '5A(6)',
    '5A(6)',
    scraped5A6?.description || 'Do ONE of the following:',
    true
  )

  // Create 5A(6)(a) header - this was 5Aa in scraped data
  const scraped5Aa = scrapedReqs.get('5Aa')
  const req5A6a = createRequirement(
    '5A(6)(a)',
    '5Aa',
    scraped5Aa?.description || 'Using a recurve bow or longbow and arrows with a finger release, shoot a single round of ONE of the following:',
    true
  )

  // Add 5A(6)(a)(1) through (4) - these were 5B(1) through 5B(4) in scraped data
  for (let i = 1; i <= 4; i++) {
    const scraped = scrapedReqs.get(`5B(${i})`)
    if (scraped) {
      req5A6a.children.push(createRequirement(
        `5A(6)(a)(${i})`,
        `5B(${i})`,
        scraped.description,
        false
      ))
    }
  }

  req5A6.children.push(req5A6a)

  // Add 5A(6)(b) - this was 5Bb in scraped data
  const scraped5Bb = scrapedReqs.get('5Bb')
  if (scraped5Bb) {
    req5A6.children.push(createRequirement(
      '5A(6)(b)',
      '5Bb',
      scraped5Bb.description,
      false
    ))
  }

  optionA.children.push(req5A6)

  // Create Option B header
  const optionB = createRequirement(
    '5B',
    '5 Option B',
    'Option B — Using a Compound Bow. Do ALL of the following:',
    true
  )

  // Add 5B(1) through 5B(5) - these were 5C(1) through 5C(5) in scraped data
  for (let i = 1; i <= 5; i++) {
    const scraped = scrapedReqs.get(`5C(${i})`)
    if (scraped) {
      optionB.children.push(createRequirement(
        `5B(${i})`,
        `5C(${i})`,
        scraped.description,
        false
      ))
    }
  }

  // Create 5B(6) header - this was 5C(6) in scraped data
  const scraped5C6 = scrapedReqs.get('5C(6)')
  const req5B6 = createRequirement(
    '5B(6)',
    '5C(6)',
    scraped5C6?.description || 'Do ONE of the following:',
    true
  )

  // Create 5B(6)(a) header - this was 5Ca in scraped data
  const scraped5Ca = scrapedReqs.get('5Ca')
  const req5B6a = createRequirement(
    '5B(6)(a)',
    '5Ca',
    scraped5Ca?.description || 'Using a compound bow and arrows with a finger release, shoot a single round of ONE of the following:',
    true
  )

  // Add 5B(6)(a)(1) through (4) - these were 5D(1) through 5D(4) in scraped data
  for (let i = 1; i <= 4; i++) {
    const scraped = scrapedReqs.get(`5D(${i})`)
    if (scraped) {
      req5B6a.children.push(createRequirement(
        `5B(6)(a)(${i})`,
        `5D(${i})`,
        scraped.description,
        false
      ))
    }
  }

  req5B6.children.push(req5B6a)

  // Add 5B(6)(b) - this was 5Db in scraped data
  const scraped5Db = scrapedReqs.get('5Db')
  if (scraped5Db) {
    req5B6.children.push(createRequirement(
      '5B(6)(b)',
      '5Db',
      scraped5Db.description,
      false
    ))
  }

  optionB.children.push(req5B6)

  // Set req 5 children
  req5.children = [optionA, optionB]
  req5.is_header = true

  // Recalculate nesting depths and display orders
  recalculateNestingDepth(v2025.requirements, 1)
  recalculateDisplayOrder(v2025.requirements, 1)

  // Count requirements
  function countReqs(reqs: Requirement[]): number {
    let count = 0
    for (const r of reqs) {
      count++
      if (r.children) count += countReqs(r.children)
    }
    return count
  }

  console.log('\nNew requirement 5 structure:')
  console.log('  5 [H]')
  for (const child of req5.children) {
    console.log(`    ${child.requirement_number} [H] (${countReqs([child])} total)`)
    for (const grandchild of child.children.slice(0, 3)) {
      console.log(`      ${grandchild.requirement_number}${grandchild.is_header ? ' [H]' : ''}`)
    }
    if (child.children.length > 3) {
      console.log(`      ... and ${child.children.length - 3} more`)
    }
  }

  console.log('\nTotal requirements in v2025:', countReqs(v2025.requirements))

  // Write back
  console.log('\nWriting updated canonical data...')
  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(data, null, 2))
  console.log('Done!')
}

main().catch(console.error)
