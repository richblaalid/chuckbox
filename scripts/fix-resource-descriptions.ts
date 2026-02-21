/**
 * Fix requirement descriptions that contain "Resource:" or "Resources:" text.
 *
 * The Scoutbook scraper captured resource link text as part of requirement descriptions.
 * The canonical data was cleaned, but the database may have stale descriptions from
 * before the cleanup. This script:
 * 1. Strips "Resource(s):..." suffix from descriptions
 * 2. Falls back to canonical data for descriptions that are mostly resource text
 *
 * Usage: npx tsx scripts/fix-resource-descriptions.ts
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Build a lookup from canonical data for fallback descriptions
function buildCanonicalLookup(): Map<string, string> {
  const canonical = JSON.parse(readFileSync('data/bsa-data-canonical-normalized.json', 'utf-8'))
  const lookup = new Map<string, string>()

  function addReqs(reqs: any[]) {
    for (const req of reqs || []) {
      if (req.scoutbook_id && req.description) {
        // Key by scoutbook_id since it matches requirement_number
        lookup.set(req.scoutbook_id, req.description)
      }
      addReqs(req.children)
    }
  }

  for (const badge of canonical.merit_badges) {
    for (const ver of badge.versions || []) {
      addReqs(ver.requirements)
    }
  }

  return lookup
}

async function fetchAllMatching(): Promise<Array<{ id: string; requirement_number: string; description: string }>> {
  const allRows: Array<{ id: string; requirement_number: string; description: string }> = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, requirement_number, description')
      .or('description.ilike.%Resource:%,description.ilike.%Resources:%')
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('Query error:', error.message)
      process.exit(1)
    }

    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return allRows
}

async function main() {
  console.log('Building canonical lookup...')
  const canonicalLookup = buildCanonicalLookup()
  console.log(`Canonical lookup: ${canonicalLookup.size} requirements\n`)

  console.log('Fetching requirements with "Resource(s):" in description...')
  const reqs = await fetchAllMatching()

  if (reqs.length === 0) {
    console.log('No requirements found with "Resource:" text in descriptions.')
    return
  }

  // Filter to only those that actually have the Resource: label pattern
  const toFix = reqs.filter(r => /\bResources?\s*:\s*/i.test(r.description))

  console.log(`Found ${reqs.length} total, ${toFix.length} need fixing\n`)

  let fixed = 0
  let skipped = 0
  let usedCanonical = 0

  for (const req of toFix) {
    // Strip "Resource:" or "Resources:" and everything after it
    let cleaned = req.description.replace(/\s*\bResources?\s*:.*$/i, '').trim()

    // If cleaned is too short, try canonical lookup
    if (cleaned.length < 5) {
      const canonical = canonicalLookup.get(req.requirement_number)
      if (canonical) {
        cleaned = canonical
        usedCanonical++
      } else {
        console.log(`  SKIP [${req.requirement_number}] - too short and no canonical: "${cleaned}"`)
        skipped++
        continue
      }
    }

    if (cleaned === req.description) {
      skipped++
      continue
    }

    const { error: updateError } = await supabase
      .from('bsa_merit_badge_requirements')
      .update({ description: cleaned })
      .eq('id', req.id)

    if (updateError) {
      console.error(`  ERROR [${req.requirement_number}]: ${updateError.message}`)
    } else {
      fixed++
      if (fixed <= 10) {
        console.log(`  Fixed [${req.requirement_number}]:`)
        console.log(`    Before: "${req.description.substring(0, 120)}..."`)
        console.log(`    After:  "${cleaned.substring(0, 120)}"`)
      }
    }
  }

  console.log(`\nDone. Fixed: ${fixed}, Used canonical fallback: ${usedCanonical}, Skipped: ${skipped}`)

  // Verify - check if any remain
  const remaining = await fetchAllMatching()
  const stillBroken = remaining.filter(r => /\bResources?\s*:\s*/i.test(r.description))
  console.log(`\nVerification: ${stillBroken.length} descriptions still have "Resource(s):" text`)
  if (stillBroken.length > 0 && stillBroken.length <= 10) {
    stillBroken.forEach(r => {
      console.log(`  [${r.requirement_number}]: "${r.description.substring(0, 100)}"`)
    })
  }
}

main()
