#!/usr/bin/env npx tsx
/**
 * Check ID format variations across different badges
 * Verify we're preserving exact Scoutbook formats
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Check sample IDs from different badges to see format variations
  const badges = [
    { name: 'Citizenship in the Community', year: 2026 },
    { name: 'Cycling', year: 2026 },
    { name: 'Environmental Science', year: 2020 },
    { name: 'Personal Fitness', year: 2020 },
    { name: 'Rifle Shooting', year: 2002 },
    { name: 'Animal Science', year: 2023 },
    { name: 'Archery', year: 2025 },
    { name: 'Fingerprinting', year: 2004 },
  ]

  console.log('Checking ID format preservation per badge/version:')
  console.log('='.repeat(60))

  for (const badge of badges) {
    const { data: version } = await supabase
      .from('merit_badge_versions')
      .select('id, id_format')
      .eq('badge_name', badge.name)
      .eq('version_year', badge.year)
      .single()

    if (version === null) {
      console.log(`\n${badge.name} ${badge.year}: NOT FOUND`)
      continue
    }

    const { data: reqs } = await supabase
      .from('merit_badge_requirements')
      .select('scoutbook_id')
      .eq('badge_version_id', version.id)
      .order('sort_order')
      .limit(15)

    console.log(`\n${badge.name} ${badge.year}:`)
    console.log(`  id_format: ${version.id_format || 'not set'}`)
    console.log(`  Sample IDs: ${reqs?.map((r) => r.scoutbook_id).join(', ')}`)
  }

  // Show overall format distribution
  console.log('\n' + '='.repeat(60))
  console.log('FORMAT DISTRIBUTION ANALYSIS')
  console.log('='.repeat(60))

  const { data: allReqs } = await supabase.from('merit_badge_requirements').select('scoutbook_id').limit(5000)

  const patterns: Record<string, number> = {}

  for (const req of allReqs || []) {
    // Classify the ID format
    const id = req.scoutbook_id
    let pattern = 'unknown'

    if (/^\d+$/.test(id)) {
      pattern = 'number_only'
    } else if (/^\d+\.$/.test(id)) {
      pattern = 'number_dot'
    } else if (/^\d+[a-z]$/i.test(id)) {
      pattern = 'number_letter'
    } else if (/^\d+\([a-z]\)$/i.test(id)) {
      pattern = 'number_paren_letter'
    } else if (/^\d+[a-z]\[\d+\]/i.test(id)) {
      pattern = 'number_letter_bracket'
    } else if (/^\d+\([a-z]\)\(\d+\)/i.test(id)) {
      pattern = 'number_paren_letter_paren_num'
    } else if (/option/i.test(id)) {
      pattern = 'contains_option'
    } else if (/\[/.test(id)) {
      pattern = 'contains_bracket'
    } else if (/\(/.test(id)) {
      pattern = 'contains_paren'
    } else {
      pattern = 'other'
    }

    patterns[pattern] = (patterns[pattern] || 0) + 1
  }

  console.log('\nID Format Patterns (from sample of 5000):')
  const sortedPatterns = Object.entries(patterns).sort((a, b) => b[1] - a[1])
  for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${pattern}: ${count}`)
  }
}

main().catch(console.error)
