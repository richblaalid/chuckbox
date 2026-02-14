#!/usr/bin/env npx tsx

/**
 * Fix rank versions in bsa-data-canonical-normalized.json
 *
 * Changes:
 * 1. Remove incorrect Tenderfoot 2016 version (doesn't exist on Scoutbook)
 * 2. Note: Second Class 2016 and First Class 2016 need to be added (data TBD)
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NORMALIZED_PATH = path.join(__dirname, '../data/bsa-data-canonical-normalized.json')

interface Requirement {
  requirement_number: string
  description: string
  is_header: boolean
  display_order: number
  children?: Requirement[]
}

interface RankVersion {
  version_year: number
  requirements: Requirement[]
}

interface Rank {
  code: string
  name: string
  description: string
  display_order: number
  image_url: string
  is_eagle_required: boolean
  requirement_version_year: number
  versions: RankVersion[]
}

interface NormalizedData {
  merit_badges: unknown[]
  ranks: Rank[]
  leadership_positions: unknown[]
  [key: string]: unknown
}

async function main() {
  console.log('Loading normalized data...')
  const data: NormalizedData = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf-8'))

  // Find Tenderfoot
  const tenderfoot = data.ranks.find(r => r.name === 'Tenderfoot')
  if (!tenderfoot) {
    console.error('Tenderfoot not found')
    process.exit(1)
  }

  console.log('')
  console.log('=== Before ===')
  console.log('Tenderfoot versions:', tenderfoot.versions.map(v => v.version_year))

  // Remove 2016 version
  const before = tenderfoot.versions.length
  tenderfoot.versions = tenderfoot.versions.filter(v => v.version_year !== 2016)
  const after = tenderfoot.versions.length

  if (before === after) {
    console.log('No 2016 version found to remove')
  } else {
    console.log(`Removed Tenderfoot 2016 version (${before} -> ${after} versions)`)
  }

  // Update requirement_version_year to match current version
  if (tenderfoot.versions.length > 0) {
    const currentVersion = Math.max(...tenderfoot.versions.map(v => v.version_year))
    tenderfoot.requirement_version_year = currentVersion
  }

  console.log('')
  console.log('=== After ===')
  console.log('Tenderfoot versions:', tenderfoot.versions.map(v => v.version_year))
  console.log('Tenderfoot requirement_version_year:', tenderfoot.requirement_version_year)

  // Show current state of all ranks
  console.log('')
  console.log('=== All Ranks Status ===')
  for (const r of data.ranks) {
    const versions = r.versions.map(v => v.version_year).join(', ')
    console.log(`  ${r.name}: versions=[${versions}], current=${r.requirement_version_year}`)
  }

  // Write back
  console.log('')
  console.log('Writing updated normalized data...')
  fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(data, null, 2))

  // Also update the copy
  const canonicalPath = path.join(__dirname, '../data/bsa-data-canonical.json')
  fs.writeFileSync(canonicalPath, JSON.stringify(data, null, 2))
  console.log('Also updated bsa-data-canonical.json')

  console.log('Done!')
}

main().catch(console.error)
