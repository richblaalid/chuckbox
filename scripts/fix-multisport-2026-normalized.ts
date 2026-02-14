#!/usr/bin/env npx tsx

/**
 * Fix Multisport v2026 in bsa-data-canonical-normalized.json
 *
 * Adds missing requirement 4 sub-requirements with correct scoutbook_ids
 * from the CSV export (4 Option A (1)(a), 4 Option A (1)(b), etc.)
 *
 * Uses v2025 structure as template, mapping to v2026 scoutbook_ids
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NORMALIZED_PATH = path.join(__dirname, '../data/bsa-data-canonical-normalized.json')

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  nesting_depth?: number
  display_order?: number
  children: Requirement[]
}

interface BadgeVersion {
  version_year: number
  version_date?: string
  is_current?: boolean
  is_estimated?: boolean
  requirements: Requirement[]
}

interface Badge {
  name: string
  versions: BadgeVersion[]
  [key: string]: unknown
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

function createReq(reqNum: string, scoutbookId: string, description: string, isHeader: boolean): Requirement {
  return {
    requirement_number: reqNum,
    scoutbook_id: scoutbookId,
    description,
    is_header: isHeader,
    children: []
  }
}

function countReqs(reqs: Requirement[]): number {
  let count = 0
  for (const r of reqs) {
    count++
    if (r.children) count += countReqs(r.children)
  }
  return count
}

async function main() {
  console.log('Loading normalized data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf-8'))

  const badge = data.merit_badges.find(b => b.name === 'Multisport')
  if (!badge) {
    console.error('Multisport badge not found')
    process.exit(1)
  }

  const v2026 = badge.versions.find(v => v.version_year === 2026)
  if (!v2026) {
    console.error('Multisport v2026 not found')
    process.exit(1)
  }

  const v2025 = badge.versions.find(v => v.version_year === 2025)
  if (!v2025) {
    console.error('Multisport v2025 not found (needed as template)')
    process.exit(1)
  }

  console.log('v2026 before fix:', countReqs(v2026.requirements), 'requirements')
  console.log('v2025 (template):', countReqs(v2025.requirements), 'requirements')

  const req4 = v2026.requirements.find(r => r.requirement_number === '4')
  if (!req4) {
    console.error('Requirement 4 not found')
    process.exit(1)
  }

  // Build new structure using descriptions from v2025 but scoutbook_ids for v2026
  // The CSV scoutbook_ids follow pattern: "4 Option A (1)(a)", "4 Option B (2)(c)", etc.
  // Note: CSV has typo "4 Option B ( 2)(b)" with extra space

  // Option A - Triathlon (swimming, biking, running)
  const optionA = createReq('4A', '4A', 'Option A—Triathlon: Do ALL of the following for swimming, biking, and running.', true)

  // 4A(1) - Swimming
  const optA1 = createReq('4A(1)', '4A(1)', '(1) Swimming', true)
  optA1.children = [
    createReq('4A(1)(a)', '4 Option A (1)(a)', 'Before doing requirements 5 through 8, earn the Swimming merit badge.', false),
    createReq('4A(1)(b)', '4 Option A (1)(b)', 'Explain the components of the Scouting America Safe Swim Defense program and how you will ensure they are in place when you swim.', false),
    createReq('4A(1)(c)', '4 Option A (1)(c)', 'Explain to your counselor the difference between a pool swim and an open water swim, including at what water temperature it is appropriate to wear a wet suit.', false),
  ]

  // 4A(2) - Biking
  const optA2 = createReq('4A(2)', '4A(2)', '(2) Biking', true)
  optA2.children = [
    createReq('4A(2)(a)', '4 Option A (2)(a)', 'Explain to your counselor how to ride predictably, be conspicuous, think ahead, and ride ready.', false),
    createReq('4A(2)(b)', '4 Option A (2)(b)', 'Discuss what should be checked regularly to make sure the bicycle is safe to ride.', false),
    createReq('4A(2)(c)', '4 Option A (2)(c)', 'Explain the importance of wearing a properly sized and fitted helmet while cycling and of wearing the right clothing for the weather.', false),
  ]

  // 4A(3) - Running
  const optA3 = createReq('4A(3)', '4A(3)', '(3) Running', true)
  optA3.children = [
    createReq('4A(3)(a)', '4 Option A (3)(a)', 'Demonstrate a proper run warmup and cool-down. Explain to your counselor the importance of maintaining healthy habits, including hydration, nutrition, injury prevention, and rest.', false),
    createReq('4A(3)(b)', '4 Option A (3)(b)', 'Learn and state the basic rules of the road for runners.', false),
    createReq('4A(3)(c)', '4 Option A (3)(c)', 'Demonstrate important running drills, including high knees, butt kicks, lunges, inchworms, and soldier kicks.', false),
  ]

  optionA.children = [optA1, optA2, optA3]

  // Option B - Duathlon (biking, running)
  const optionB = createReq('4B', '4B', 'Option B—Duathlon: Do ALL of the following for biking and running.', true)

  // 4B(1) - Biking
  const optB1 = createReq('4B(1)', '4B(1)', '(1) Biking', true)
  optB1.children = [
    createReq('4B(1)(a)', '4 Option B (1)(a)', 'Explain to your counselor how to ride predictably, be conspicuous, think ahead, and ride ready.', false),
    createReq('4B(1)(b)', '4 Option B (1)(b)', 'Discuss what should be checked regularly to make sure the bicycle is safe to ride.', false),
    createReq('4B(1)(c)', '4 Option B (1)(c)', 'Explain the importance of wearing a properly sized and fitted helmet while cycling and of wearing the right clothing for the weather.', false),
  ]

  // 4B(2) - Running (note CSV typo: "4 Option B ( 2)(b)" has extra space)
  const optB2 = createReq('4B(2)', '4B(2)', '(2) Running', true)
  optB2.children = [
    createReq('4B(2)(a)', '4 Option B (2)(a)', 'Demonstrate a proper run warmup and cool-down. Explain to your counselor the importance of maintaining healthy habits, including hydration, nutrition, injury prevention, and rest.', false),
    createReq('4B(2)(b)', '4 Option B ( 2)(b)', 'Learn and state the basic rules of the road for runners.', false), // CSV has typo with space
    createReq('4B(2)(c)', '4 Option B (2)(c)', 'Demonstrate important running drills, including high knees, butt kicks, lunges, inchworms, and soldier kicks.', false),
  ]

  optionB.children = [optB1, optB2]

  // Option C - Aquathlon (swimming, running)
  const optionC = createReq('4C', '4C', 'Option C—Aquathlon: Do ALL of the following for swimming and running.', true)

  // 4C(1) - Swimming
  const optC1 = createReq('4C(1)', '4C(1)', '(1) Swimming', true)
  optC1.children = [
    createReq('4C(1)(a)', '4 Option C (1)(a)', 'Before doing requirements 5 through 8, earn the Swimming merit badge.', false),
    createReq('4C(1)(b)', '4 Option C (1)(b)', 'Explain the components of the Scouting America Safe Swim Defense program and how you will ensure they are in place when you swim.', false),
    createReq('4C(1)(c)', '4 Option C (1)(c)', 'Explain to your counselor the difference between a pool swim and an open water swim, including at what water temperature it is appropriate to wear a wet suit.', false),
  ]

  // 4C(2) - Running
  const optC2 = createReq('4C(2)', '4C(2)', '(2) Running', true)
  optC2.children = [
    createReq('4C(2)(a)', '4 Option C (2)(a)', 'Demonstrate a proper run warmup and cool-down. Explain to your counselor the importance of maintaining healthy habits, including hydration, nutrition, injury prevention, and rest.', false),
    createReq('4C(2)(b)', '4 Option C (2)(b)', 'Learn and state the basic rules of the road for runners.', false),
    createReq('4C(2)(c)', '4 Option C (2)(c)', 'Demonstrate important running drills, including high knees, butt kicks, lunges, inchworms, and soldier kicks.', false),
  ]

  optionC.children = [optC1, optC2]

  // Option D - Aquabike (swimming, biking)
  const optionD = createReq('4D', '4D', 'Option D—Aquabike: Do ALL of the following for swimming and biking.', true)

  // 4D(1) - Swimming
  const optD1 = createReq('4D(1)', '4D(1)', '(1) Swimming', true)
  optD1.children = [
    createReq('4D(1)(a)', '4 Option D (1)(a)', 'Before doing requirements 5 through 8, earn the Swimming merit badge.', false),
    createReq('4D(1)(b)', '4 Option D (1)(b)', 'Explain the components of the Scouting America Safe Swim Defense program and how you will ensure they are in place when you swim.', false),
    createReq('4D(1)(c)', '4 Option D (1)(c)', 'Explain to your counselor the difference between a pool swim and an open water swim, including at what water temperature it is appropriate to wear a wet suit.', false),
  ]

  // 4D(2) - Biking
  const optD2 = createReq('4D(2)', '4D(2)', '(2) Biking', true)
  optD2.children = [
    createReq('4D(2)(a)', '4 Option D (2)(a)', 'Explain to your counselor how to ride predictably, be conspicuous, think ahead, and ride ready.', false),
    createReq('4D(2)(b)', '4 Option D (2)(b)', 'Discuss what should be checked regularly to make sure the bicycle is safe to ride.', false),
    createReq('4D(2)(c)', '4 Option D (2)(c)', 'Explain the importance of wearing a properly sized and fitted helmet while cycling and of wearing the right clothing for the weather.', false),
  ]

  optionD.children = [optD1, optD2]

  // Update req 4
  req4.children = [optionA, optionB, optionC, optionD]
  req4.is_header = true

  // Recalculate
  recalculateNestingDepth(v2026.requirements, 1)
  recalculateDisplayOrder(v2026.requirements, 1)

  console.log('\nv2026 after fix:', countReqs(v2026.requirements), 'requirements')

  // Show structure
  console.log('\nNew requirement 4 structure:')
  function printTree(reqs: Requirement[], indent = '') {
    for (const r of reqs) {
      const marker = r.is_header ? '[H]' : ''
      console.log(`${indent}${marker} ${r.requirement_number} (scoutbook: ${r.scoutbook_id})`)
      if (r.children?.length) {
        printTree(r.children, indent + '  ')
      }
    }
  }
  printTree([req4])

  // Write back
  console.log('\nWriting updated normalized data...')
  fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(data, null, 2))
  console.log('Done!')
}

main().catch(console.error)
