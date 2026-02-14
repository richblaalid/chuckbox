#!/usr/bin/env npx tsx
/**
 * Compare descriptions between BSA tables and new merit_badge_* tables
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Get a sample badge that exists in both tables
  const testBadge = 'Citizenship in the Community'
  const testYear = 2026

  // Get BSA version
  const { data: bsaBadge } = await supabase
    .from('bsa_merit_badges')
    .select('id, name')
    .eq('name', testBadge)
    .single()

  if (!bsaBadge) {
    console.error('Badge not found in BSA tables')
    return
  }

  // Get BSA requirements
  const { data: bsaReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('scoutbook_requirement_number, description, requirement_number')
    .eq('merit_badge_id', bsaBadge.id)
    .eq('version_year', testYear)
    .order('display_order')
    .limit(20)

  // Get new table version
  const { data: newVersion } = await supabase
    .from('merit_badge_versions')
    .select('id')
    .eq('badge_name', testBadge)
    .eq('version_year', testYear)
    .single()

  if (!newVersion) {
    console.error('Badge not found in new tables')
    return
  }

  // Get new requirements
  const { data: newReqs } = await supabase
    .from('merit_badge_requirements')
    .select('scoutbook_id, description, display_label')
    .eq('badge_version_id', newVersion.id)
    .order('sort_order')
    .limit(20)

  console.log(`Comparing: ${testBadge} ${testYear}`)
  console.log('=' .repeat(60))

  console.log('\nBSA Table requirements:')
  bsaReqs?.forEach((r, i) => {
    console.log(`  ${r.scoutbook_requirement_number}: ${r.description?.substring(0, 60)}...`)
  })

  console.log('\nNew Table requirements:')
  newReqs?.forEach((r, i) => {
    console.log(`  ${r.scoutbook_id}: ${r.description?.substring(0, 60)}...`)
  })

  // Compare specific matches
  console.log('\n' + '='.repeat(60))
  console.log('DETAILED COMPARISON (first 5 with content)')
  console.log('='.repeat(60))

  const bsaMap = new Map(bsaReqs?.map(r => [r.scoutbook_requirement_number, r.description]) || [])

  let compared = 0
  for (const newReq of newReqs || []) {
    if (compared >= 5) break
    const bsaDesc = bsaMap.get(newReq.scoutbook_id)
    if (bsaDesc && newReq.description && newReq.description !== bsaDesc) {
      console.log(`\nRequirement: ${newReq.scoutbook_id}`)
      console.log('BSA:', bsaDesc.substring(0, 100))
      console.log('NEW:', newReq.description.substring(0, 100))
      compared++
    }
  }

  // Check if scoutbook IDs match
  console.log('\n' + '='.repeat(60))
  console.log('SCOUTBOOK ID COMPARISON')
  console.log('='.repeat(60))

  const bsaIds = new Set(bsaReqs?.map(r => r.scoutbook_requirement_number) || [])
  const newIds = new Set(newReqs?.map(r => r.scoutbook_id) || [])

  const inBsaOnly = [...bsaIds].filter(id => !newIds.has(id))
  const inNewOnly = [...newIds].filter(id => !bsaIds.has(id))

  console.log('IDs only in BSA:', inBsaOnly.length, inBsaOnly.slice(0, 10))
  console.log('IDs only in New:', inNewOnly.length, inNewOnly.slice(0, 10))
}

main().catch(console.error)
