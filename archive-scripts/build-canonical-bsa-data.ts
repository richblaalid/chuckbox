#!/usr/bin/env npx tsx
/**
 * Build Canonical BSA Data
 *
 * Creates a single source of truth file with:
 * 1. Exact Scoutbook requirement IDs (from merit_badge_requirements table)
 * 2. Full hierarchy with parent/child relationships (from unified export)
 * 3. Header descriptions for UI display
 *
 * Strategy:
 * - Use unified export as the base (has hierarchy)
 * - Query merit_badge_requirements table for correct Scoutbook IDs
 * - Match requirements by badge name + version year + requirement position
 * - Update scoutbook_id values in the unified structure
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

const PAGE_SIZE = 1000

interface UnifiedRequirement {
  requirement_number: string
  sub_requirement_letter: string | null
  description: string | null
  display_order: number
  is_header: boolean
  is_alternative: boolean
  alternatives_group: string | null
  required_count: number | null
  scoutbook_id: string | null
  children: UnifiedRequirement[]
}

async function build() {
  console.log('='.repeat(60))
  console.log('BUILD CANONICAL BSA DATA')
  console.log('='.repeat(60))
  console.log('')

  // Step 1: Load unified export (hierarchy source)
  console.log('Step 1: Loading unified export (hierarchy source)...')
  const unifiedPath = path.join(process.cwd(), 'data/bsa-data-unified.json')
  const unified = JSON.parse(fs.readFileSync(unifiedPath, 'utf-8'))
  console.log(`  Loaded ${unified.merit_badges.length} badges from unified export`)

  // Step 2: Load all merit_badge_versions (maps badge name -> version -> requirements)
  console.log('\nStep 2: Loading merit_badge_versions (Scoutbook ID source)...')
  const { data: versions, error: versionError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .order('badge_name')
    .order('version_year')

  if (versionError || !versions) {
    console.error('  Error loading versions:', versionError?.message)
    return
  }
  console.log(`  Loaded ${versions.length} versions`)

  // Step 3: Load ALL merit_badge_requirements (has correct Scoutbook IDs)
  console.log('\nStep 3: Loading merit_badge_requirements (paginated)...')
  const allReqs: Array<{
    id: string
    badge_version_id: string
    scoutbook_id: string
    display_label: string | null
    description: string | null
    parent_id: string | null
    depth: number
    sort_order: number
    is_header: boolean
  }> = []

  let offset = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('merit_badge_requirements')
      .select('id, badge_version_id, scoutbook_id, display_label, description, parent_id, depth, sort_order, is_header')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('  Error loading requirements:', error.message)
      return
    }
    if (!batch || batch.length === 0) break
    allReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  console.log(`  Loaded ${allReqs.length} requirements with Scoutbook IDs`)

  // Group requirements by version_id
  const reqsByVersionId = new Map<string, typeof allReqs>()
  for (const req of allReqs) {
    if (!reqsByVersionId.has(req.badge_version_id)) {
      reqsByVersionId.set(req.badge_version_id, [])
    }
    reqsByVersionId.get(req.badge_version_id)!.push(req)
  }

  // Create lookup: badge_name:version_year -> version_id
  const versionIdLookup = new Map<string, string>()
  for (const v of versions) {
    versionIdLookup.set(`${v.badge_name.toLowerCase()}:${v.version_year}`, v.id)
  }

  // Step 4: Update unified export with correct Scoutbook IDs
  console.log('\nStep 4: Merging Scoutbook IDs into unified structure...')

  let badgesUpdated = 0
  let versionsUpdated = 0
  let requirementsUpdated = 0
  let versionsMissing = 0

  // Badge name normalization for matching
  const BADGE_NAME_MAP: Record<string, string> = {
    'fish & wildlife management': 'fish and wildlife management',
    'artificial intelligence': 'artificial intelligence (ai)',
  }

  for (const badge of unified.merit_badges) {
    let badgeHasUpdates = false
    const normalizedBadgeName = BADGE_NAME_MAP[badge.name.toLowerCase()] || badge.name.toLowerCase()

    for (const version of badge.versions) {
      const lookupKey = `${normalizedBadgeName}:${version.version_year}`
      const versionId = versionIdLookup.get(lookupKey)

      if (!versionId) {
        // Try original name
        const altKey = `${badge.name.toLowerCase()}:${version.version_year}`
        const altVersionId = versionIdLookup.get(altKey)
        if (!altVersionId) {
          versionsMissing++
          continue
        }
      }

      const scoutbookReqs = reqsByVersionId.get(versionId || '') || []
      if (scoutbookReqs.length === 0) {
        versionsMissing++
        continue
      }

      versionsUpdated++
      badgeHasUpdates = true

      // Sort Scoutbook requirements by sort_order
      scoutbookReqs.sort((a, b) => a.sort_order - b.sort_order)

      // Build lookup maps for Scoutbook IDs
      // Key by scoutbook_id for exact matching
      const scoutbookById = new Map(scoutbookReqs.map(r => [r.scoutbook_id, r]))

      // Also key by normalized scoutbook_id (without trailing periods)
      const scoutbookByNormalized = new Map<string, typeof scoutbookReqs[0]>()
      for (const r of scoutbookReqs) {
        const normalized = r.scoutbook_id.replace(/\.$/, '')
        if (!scoutbookByNormalized.has(normalized)) {
          scoutbookByNormalized.set(normalized, r)
        }
      }

      // Convert unified notation to Scoutbook notation
      // Unified uses: 9(1), 9(2), 8a(1), 8a(2) - parentheses
      // Scoutbook uses: 9b[1], 9b[2], 8a[1], 8a[2] - brackets with letter
      function convertToScoutbookNotation(reqNum: string): string[] {
        const alternatives: string[] = [reqNum]

        // Pattern: {base}({index}) -> {base}[{index}] or {base}b[{index}]
        const parenMatch = reqNum.match(/^(\d+)([a-z]?)?\((\d+)\)$/)
        if (parenMatch) {
          const [, num, letter, index] = parenMatch
          // Try both with and without letter
          if (letter) {
            alternatives.push(`${num}${letter}[${index}]`)
          } else {
            // If no letter, try common letters like 'a', 'b'
            alternatives.push(`${num}[${index}]`)
            alternatives.push(`${num}a[${index}]`)
            alternatives.push(`${num}b[${index}]`)
          }
        }

        return alternatives
      }

      // Recursively update requirements
      function updateRequirements(reqs: UnifiedRequirement[]) {
        for (const req of reqs) {
          const reqNum = req.requirement_number
          const reqNumNormalized = reqNum.replace(/\.$/, '')

          // Try exact match first
          let scoutbook = scoutbookById.get(reqNum)

          // Try normalized (without trailing period)
          if (!scoutbook) {
            scoutbook = scoutbookByNormalized.get(reqNumNormalized)
          }

          // Try with trailing period
          if (!scoutbook) {
            scoutbook = scoutbookById.get(reqNum + '.')
          }

          // Try notation conversion (parentheses to brackets)
          if (!scoutbook) {
            const alternatives = convertToScoutbookNotation(reqNumNormalized)
            for (const alt of alternatives) {
              scoutbook = scoutbookById.get(alt) || scoutbookByNormalized.get(alt)
              if (scoutbook) break
            }
          }

          if (scoutbook) {
            req.scoutbook_id = scoutbook.scoutbook_id
            requirementsUpdated++
          }
          // Headers without Scoutbook IDs keep their original requirement_number as scoutbook_id
          // This is fine - headers are never imported as progress

          // Process children
          if (req.children && req.children.length > 0) {
            updateRequirements(req.children)
          }
        }
      }

      updateRequirements(version.requirements)
    }

    if (badgeHasUpdates) {
      badgesUpdated++
    }
  }

  console.log(`  Badges updated: ${badgesUpdated}`)
  console.log(`  Versions updated: ${versionsUpdated}`)
  console.log(`  Requirements updated: ${requirementsUpdated}`)
  console.log(`  Versions missing from Scoutbook data: ${versionsMissing}`)

  // Step 5: Write the canonical file
  console.log('\nStep 5: Writing canonical file...')
  const outputPath = path.join(process.cwd(), 'data/bsa-data-canonical.json')

  const output = {
    ...unified,
    exported_at: new Date().toISOString(),
    source: 'canonical-merged',
    version: '2.0.0',
    notes: 'Merged from unified export (hierarchy) + merit_badge_requirements (Scoutbook IDs)',
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

  const stats = fs.statSync(outputPath)
  console.log(`  Output: ${outputPath}`)
  console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)

  // Step 6: Verify a sample
  console.log('\nStep 6: Verification sample (Camping 2018)...')
  for (const badge of output.merit_badges) {
    if (badge.name === 'Camping') {
      for (const version of badge.versions) {
        if (version.version_year === 2018) {
          console.log('  Camping 2018 requirements (first 15):')
          let count = 0
          function showReqs(reqs: UnifiedRequirement[], indent = '    ') {
            for (const req of reqs) {
              if (count >= 15) return
              const header = req.is_header ? '[H] ' : '    '
              console.log(`${indent}${header}${req.requirement_number} -> ${req.scoutbook_id}`)
              count++
              if (req.children && req.children.length > 0) {
                showReqs(req.children, indent + '  ')
              }
            }
          }
          showReqs(version.requirements)
          break
        }
      }
      break
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('BUILD COMPLETE')
  console.log('='.repeat(60))
  console.log('')
  console.log('Next steps:')
  console.log('  1. Update import script to use data/bsa-data-canonical.json')
  console.log('  2. Run import and verify match rates')
}

build().catch(console.error)
