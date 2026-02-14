#!/usr/bin/env npx tsx

/**
 * Fix Archery v2025 in the scraped data file
 *
 * Updates merit-badge-requirements-scraped.json to fix the requirement 5 structure.
 *
 * Maps the confusing scraped naming to correct tree structure:
 * - 5A(1)-5A(6) -> Under Option A header
 * - 5B(1)-5B(4), 5Bb -> Under 5A(6)(a) and 5A(6)(b)
 * - 5C(1)-5C(6) -> Under Option B header
 * - 5D(1)-5D(4), 5Db -> Under 5B(6)(a) and 5B(6)(b)
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRAPED_PATH = path.join(__dirname, '../data/merit-badge-requirements-scraped.json')

interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadgeVersion {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  totalBadges: number
  completedBadges: number
  currentBadge: string | null
  badges: Record<string, ScrapedBadgeVersion>
  errors: unknown[]
  startedAt: string
  lastUpdatedAt: string
}

async function main() {
  console.log('Loading scraped data...')
  const data: ScrapedData = JSON.parse(fs.readFileSync(SCRAPED_PATH, 'utf-8'))

  // Find Archery 2025
  let archeryKey: string | null = null
  for (const key of Object.keys(data.badges)) {
    const b = data.badges[key]
    if (b.badgeName === 'Archery' && b.versionYear === 2025) {
      archeryKey = key
      break
    }
  }

  if (!archeryKey) {
    console.error('Archery 2025 not found in scraped data')
    process.exit(1)
  }

  const archery = data.badges[archeryKey]
  console.log('Found Archery 2025 at key:', archeryKey)
  console.log('Current requirements:', archery.requirements.length)

  // Build a map of existing requirements by number
  const reqMap = new Map<string, ScrapedRequirement>()
  for (const r of archery.requirements) {
    reqMap.set(r.number, r)
  }

  // Create new requirements array with correct structure
  const newReqs: ScrapedRequirement[] = []

  // Copy requirements 1-4 as-is
  for (const r of archery.requirements) {
    if (!r.number.startsWith('5')) {
      newReqs.push(r)
    }
  }

  // Get requirement 5
  const req5 = reqMap.get('5')
  if (!req5) {
    console.error('Requirement 5 not found')
    process.exit(1)
  }

  // Add requirement 5 header
  newReqs.push({
    number: '5',
    description: req5.description,
    parentNumber: null,
    depth: 0
  })

  // Add Option A header
  newReqs.push({
    number: '5A',
    description: 'Option A — Using a Recurve Bow or Longbow. Do ALL of the following:',
    parentNumber: '5',
    depth: 1
  })

  // Add 5A(1) through 5A(5) under 5A
  for (let i = 1; i <= 5; i++) {
    const r = reqMap.get(`5A(${i})`)
    if (r) {
      newReqs.push({
        number: `5A(${i})`,
        description: r.description,
        parentNumber: '5A',
        depth: 2
      })
    }
  }

  // Add 5A(6) header
  const r5A6 = reqMap.get('5A(6)')
  newReqs.push({
    number: '5A(6)',
    description: r5A6?.description || 'Do ONE of the following:',
    parentNumber: '5A',
    depth: 2
  })

  // Add 5A(6)(a) header (was 5Aa)
  const r5Aa = reqMap.get('5Aa')
  newReqs.push({
    number: '5A(6)(a)',
    description: r5Aa?.description || 'Using a recurve bow or longbow and arrows with a finger release, shoot a single round of ONE of the following:',
    parentNumber: '5A(6)',
    depth: 3
  })

  // Add 5A(6)(a)(1) through (4) (were 5B(1) through 5B(4))
  for (let i = 1; i <= 4; i++) {
    const r = reqMap.get(`5B(${i})`)
    if (r) {
      newReqs.push({
        number: `5A(6)(a)(${i})`,
        description: r.description,
        parentNumber: '5A(6)(a)',
        depth: 4
      })
    }
  }

  // Add 5A(6)(b) (was 5Bb)
  const r5Bb = reqMap.get('5Bb')
  if (r5Bb) {
    newReqs.push({
      number: '5A(6)(b)',
      description: r5Bb.description,
      parentNumber: '5A(6)',
      depth: 3
    })
  }

  // Add Option B header
  newReqs.push({
    number: '5B',
    description: 'Option B — Using a Compound Bow. Do ALL of the following:',
    parentNumber: '5',
    depth: 1
  })

  // Add 5B(1) through 5B(5) under 5B (were 5C(1) through 5C(5))
  for (let i = 1; i <= 5; i++) {
    const r = reqMap.get(`5C(${i})`)
    if (r) {
      newReqs.push({
        number: `5B(${i})`,
        description: r.description,
        parentNumber: '5B',
        depth: 2
      })
    }
  }

  // Add 5B(6) header (was 5C(6))
  const r5C6 = reqMap.get('5C(6)')
  newReqs.push({
    number: '5B(6)',
    description: r5C6?.description || 'Do ONE of the following:',
    parentNumber: '5B',
    depth: 2
  })

  // Add 5B(6)(a) header (was 5Ca)
  const r5Ca = reqMap.get('5Ca')
  newReqs.push({
    number: '5B(6)(a)',
    description: r5Ca?.description || 'Using a compound bow and arrows with a finger release, shoot a single round of ONE of the following:',
    parentNumber: '5B(6)',
    depth: 3
  })

  // Add 5B(6)(a)(1) through (4) (were 5D(1) through 5D(4))
  for (let i = 1; i <= 4; i++) {
    const r = reqMap.get(`5D(${i})`)
    if (r) {
      newReqs.push({
        number: `5B(6)(a)(${i})`,
        description: r.description,
        parentNumber: '5B(6)(a)',
        depth: 4
      })
    }
  }

  // Add 5B(6)(b) (was 5Db)
  const r5Db = reqMap.get('5Db')
  if (r5Db) {
    newReqs.push({
      number: '5B(6)(b)',
      description: r5Db.description,
      parentNumber: '5B(6)',
      depth: 3
    })
  }

  // Update archery with new requirements
  archery.requirements = newReqs
  console.log('New requirements:', newReqs.length)

  // Show new structure for req 5
  console.log('\nNew requirement 5 structure:')
  const req5Related = newReqs.filter(r => r.number.startsWith('5'))
  for (const r of req5Related) {
    const indent = '  '.repeat(r.depth)
    console.log(`${indent}${r.number} (parent: ${r.parentNumber || 'null'})`)
  }

  // Write back
  console.log('\nWriting updated scraped data...')
  fs.writeFileSync(SCRAPED_PATH, JSON.stringify(data, null, 2))
  console.log('Done!')
}

main().catch(console.error)
