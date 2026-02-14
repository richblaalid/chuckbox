#!/usr/bin/env npx tsx
/**
 * Fill Missing BSA Requirements from Canonical Data
 *
 * Finds requirements that exist in merit_badge_requirements (canonical)
 * but not in bsa_merit_badge_requirements (progress tracking), and adds them.
 *
 * This ensures all Scoutbook requirements are available for import.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const PAGE_SIZE = 1000

async function fillMissingRequirements() {
  console.log('='.repeat(60))
  console.log('Fill Missing BSA Requirements from Canonical Data')
  console.log('='.repeat(60))
  console.log('')

  // Step 1: Load all merit_badge_versions (to map badge_name -> version_year)
  const { data: versions, error: versionsError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')

  if (versionsError) {
    console.error('Failed to load versions:', versionsError)
    return
  }

  console.log('Loaded ' + versions.length + ' badge versions')

  // Create lookup: version_id -> { badge_name, version_year }
  const versionInfo = new Map<string, { badge_name: string; version_year: number }>()
  for (const v of versions) {
    versionInfo.set(v.id, { badge_name: v.badge_name, version_year: v.version_year })
  }

  // Step 2: Load all bsa_merit_badges (to map badge_name -> merit_badge_id)
  const { data: bsaBadges, error: bsaBadgesError } = await supabase
    .from('bsa_merit_badges')
    .select('id, name')

  if (bsaBadgesError) {
    console.error('Failed to load BSA badges:', bsaBadgesError)
    return
  }

  console.log('Loaded ' + bsaBadges.length + ' BSA badges')

  // Create lookup: badge_name (lowercase) -> merit_badge_id
  const bsaBadgeByName = new Map<string, string>()
  for (const badge of bsaBadges) {
    bsaBadgeByName.set(badge.name.toLowerCase(), badge.id)
  }

  // Step 3: Load all canonical requirements with pagination
  const canonicalReqs: Array<{
    id: string
    badge_version_id: string
    scoutbook_id: string
    description: string | null
    sort_order: number | null
  }> = []

  let canonicalOffset = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('merit_badge_requirements')
      .select('id, badge_version_id, scoutbook_id, description, sort_order')
      .range(canonicalOffset, canonicalOffset + PAGE_SIZE - 1)

    if (error) {
      console.error('Failed to load canonical requirements:', error)
      return
    }

    if (!batch || batch.length === 0) break
    canonicalReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    canonicalOffset += PAGE_SIZE
  }

  console.log('Loaded ' + canonicalReqs.length + ' canonical requirements')

  // Step 4: Load all bsa_merit_badge_requirements with pagination
  const bsaReqs: Array<{
    id: string
    merit_badge_id: string
    requirement_number: string
    scoutbook_requirement_number: string | null
    version_year: number | null
  }> = []

  let bsaOffset = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, requirement_number, scoutbook_requirement_number, version_year')
      .range(bsaOffset, bsaOffset + PAGE_SIZE - 1)

    if (error) {
      console.error('Failed to load BSA requirements:', error)
      return
    }

    if (!batch || batch.length === 0) break
    bsaReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    bsaOffset += PAGE_SIZE
  }

  console.log('Loaded ' + bsaReqs.length + ' BSA requirements')

  // Step 5: Create set of existing BSA requirements (by badge_id:scoutbook_id:version)
  const existingBsaReqs = new Set<string>()
  for (const req of bsaReqs) {
    // Key by scoutbook_requirement_number if available, otherwise requirement_number
    const reqNum = req.scoutbook_requirement_number || req.requirement_number
    existingBsaReqs.add(req.merit_badge_id + ':' + reqNum + ':' + req.version_year)
    // Also add by requirement_number for fallback matching
    existingBsaReqs.add(req.merit_badge_id + ':' + req.requirement_number + ':' + req.version_year)
  }

  // Step 6: Find missing requirements
  const missingReqs: Array<{
    merit_badge_id: string
    requirement_number: string
    scoutbook_requirement_number: string
    version_year: number
    description: string | null
    display_order: number
  }> = []

  for (const canonical of canonicalReqs) {
    const info = versionInfo.get(canonical.badge_version_id)
    if (!info) continue

    const bsaBadgeId = bsaBadgeByName.get(info.badge_name.toLowerCase())
    if (!bsaBadgeId) {
      // Badge doesn't exist in BSA table - skip
      continue
    }

    const key = bsaBadgeId + ':' + canonical.scoutbook_id + ':' + info.version_year
    if (!existingBsaReqs.has(key)) {
      missingReqs.push({
        merit_badge_id: bsaBadgeId,
        requirement_number: canonical.scoutbook_id, // Use scoutbook_id as the primary number
        scoutbook_requirement_number: canonical.scoutbook_id,
        version_year: info.version_year,
        description: canonical.description,
        display_order: canonical.sort_order || 0,
      })
    }
  }

  console.log('')
  console.log('Found ' + missingReqs.length + ' missing requirements')

  if (missingReqs.length === 0) {
    console.log('Nothing to do!')
    return
  }

  // Show some examples
  console.log('')
  console.log('Examples of missing requirements:')
  const examples = missingReqs.slice(0, 10)
  for (const req of examples) {
    const badge = bsaBadges.find(b => b.id === req.merit_badge_id)
    const desc = req.description ? req.description.substring(0, 60) + '...' : '(no description)'
    console.log('  ' + (badge?.name || 'Unknown') + ' ' + req.requirement_number + ' (' + req.version_year + '): ' + desc)
  }

  // Step 7: Insert missing requirements in batches
  console.log('')
  console.log('Inserting missing requirements...')

  const BATCH_SIZE = 100
  let inserted = 0
  let errors = 0

  for (let i = 0; i < missingReqs.length; i += BATCH_SIZE) {
    const batch = missingReqs.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .insert(batch)
      .select('id')

    if (error) {
      console.error('Error inserting batch:', error.message)
      errors += batch.length
    } else {
      inserted += data?.length || 0
    }

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= missingReqs.length) {
      console.log('  Processed ' + Math.min(i + BATCH_SIZE, missingReqs.length) + ' / ' + missingReqs.length)
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log('Inserted: ' + inserted)
  console.log('Errors: ' + errors)
}

fillMissingRequirements().catch(console.error)
