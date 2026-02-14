#!/usr/bin/env npx tsx
/**
 * Sync Scoutbook Requirement IDs to BSA Table
 *
 * Copies the canonical scoutbook_id values from merit_badge_requirements
 * to bsa_merit_badge_requirements.scoutbook_requirement_number
 *
 * This allows the import to match against the correct Scoutbook format
 * while keeping the progress tracking FK relationships intact.
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

async function syncScoutbookIds() {
  console.log('='.repeat(60))
  console.log('Syncing Scoutbook IDs to BSA Requirements Table')
  console.log('='.repeat(60))
  console.log('')

  // Step 1: Load all merit_badge_versions with their requirements
  const { data: versions, error: versionsError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, badge_slug, version_year')

  if (versionsError) {
    console.error('Failed to load versions:', versionsError)
    return
  }

  console.log(`Loaded ${versions?.length || 0} badge versions`)

  // Step 2: Load all merit_badge_requirements (canonical data) with pagination
  const canonicalReqs: Array<{
    id: string
    badge_version_id: string
    scoutbook_id: string
    main_req: string | null
    section: string | null
    item: string | null
  }> = []

  let canonicalOffset = 0
  while (true) {
    const { data: batch, error: canonicalError } = await supabase
      .from('merit_badge_requirements')
      .select('id, badge_version_id, scoutbook_id, main_req, section, item')
      .range(canonicalOffset, canonicalOffset + PAGE_SIZE - 1)

    if (canonicalError) {
      console.error('Failed to load canonical requirements:', canonicalError)
      return
    }

    if (!batch || batch.length === 0) break
    canonicalReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    canonicalOffset += PAGE_SIZE
  }

  console.log(`Loaded ${canonicalReqs.length} canonical requirements`)

  // Step 3: Load all bsa_merit_badges
  const { data: bsaBadges, error: bsaBadgesError } = await supabase
    .from('bsa_merit_badges')
    .select('id, name, code')

  if (bsaBadgesError) {
    console.error('Failed to load BSA badges:', bsaBadgesError)
    return
  }

  // Create lookup by normalized name
  const bsaBadgeByName = new Map<string, { id: string; name: string; code: string }>()
  for (const badge of bsaBadges || []) {
    const normalizedName = badge.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    bsaBadgeByName.set(normalizedName, badge)
    bsaBadgeByName.set(badge.name.toLowerCase(), badge)
  }

  // Step 4: Load all bsa_merit_badge_requirements
  const allBsaReqs: Array<{
    id: string
    merit_badge_id: string
    requirement_number: string
    version_year: number | null
  }> = []

  let offset = 0
  while (true) {
    const { data: batch } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, requirement_number, version_year')
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    allBsaReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`Loaded ${allBsaReqs.length} BSA requirements`)

  // Create version lookup: badge_name -> version_year -> version_id
  const versionLookup = new Map<string, Map<number, string>>()
  for (const v of versions || []) {
    if (!versionLookup.has(v.badge_name)) {
      versionLookup.set(v.badge_name, new Map())
    }
    versionLookup.get(v.badge_name)!.set(v.version_year, v.id)
  }

  // Create canonical lookup: version_id -> requirement_number -> scoutbook_id
  // The requirement_number in BSA table might be like "2(1)" while canonical has "2b[1]"
  // We need to match by structure (main_req, section, item)
  const canonicalByVersion = new Map<string, typeof canonicalReqs>()
  for (const req of canonicalReqs || []) {
    if (!canonicalByVersion.has(req.badge_version_id)) {
      canonicalByVersion.set(req.badge_version_id, [])
    }
    canonicalByVersion.get(req.badge_version_id)!.push(req)
  }

  // Create bsa_badge_id -> badge_name lookup
  const bsaBadgeNameById = new Map<string, string>()
  for (const badge of bsaBadges || []) {
    bsaBadgeNameById.set(badge.id, badge.name)
  }

  // Step 5: For each BSA requirement, find matching canonical and copy scoutbook_id
  let updated = 0
  let notFound = 0
  const notFoundExamples: string[] = []
  const updates: Array<{ id: string; scoutbook_requirement_number: string }> = []

  for (const bsaReq of allBsaReqs) {
    const badgeName = bsaBadgeNameById.get(bsaReq.merit_badge_id)
    if (!badgeName) continue

    const versionMap = versionLookup.get(badgeName)
    if (!versionMap) continue

    const versionId = versionMap.get(bsaReq.version_year || 0)
    if (!versionId) continue

    const canonicalReqsForVersion = canonicalByVersion.get(versionId)
    if (!canonicalReqsForVersion) continue

    // Try to find matching canonical requirement
    // First, try exact match on scoutbook_id (in case BSA already has bracket format)
    let match = canonicalReqsForVersion.find(c => c.scoutbook_id === bsaReq.requirement_number)

    if (!match) {
      // Try to match by parsing the BSA format and finding equivalent
      // BSA: "2(1)" should match canonical "2b[1]" or "2a[1]"
      // BSA: "1a" should match canonical "1a"

      // Parse BSA requirement number
      const parenMatch = bsaReq.requirement_number.match(/^(\d+)\((\d+)\)$/)
      if (parenMatch) {
        // It's a parenthetical format like "2(1)"
        const mainNum = parenMatch[1]
        const itemNum = parenMatch[2]

        // Find canonical with same main_req and item
        match = canonicalReqsForVersion.find(c =>
          c.main_req === mainNum && c.item === itemNum
        )
      } else {
        // Simple format like "1a" - direct match on scoutbook_id
        match = canonicalReqsForVersion.find(c =>
          c.scoutbook_id === bsaReq.requirement_number ||
          c.scoutbook_id === bsaReq.requirement_number + '.' ||
          c.scoutbook_id.replace('.', '') === bsaReq.requirement_number
        )
      }
    }

    if (match) {
      updates.push({
        id: bsaReq.id,
        scoutbook_requirement_number: match.scoutbook_id
      })
      updated++
    } else {
      notFound++
      if (notFoundExamples.length < 20) {
        notFoundExamples.push(`${badgeName} ${bsaReq.requirement_number} (version ${bsaReq.version_year})`)
      }
    }
  }

  console.log('')
  console.log(`Found matches: ${updated}`)
  console.log(`Not found: ${notFound}`)

  if (notFoundExamples.length > 0) {
    console.log('')
    console.log('Examples not found:')
    notFoundExamples.forEach(ex => console.log(`  - ${ex}`))
  }

  // Step 6: Apply updates in batches
  if (updates.length > 0) {
    console.log('')
    console.log(`Applying ${updates.length} updates...`)

    const BATCH_SIZE = 100
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE)

      // Update each record individually (Supabase doesn't support bulk update well)
      for (const update of batch) {
        await supabase
          .from('bsa_merit_badge_requirements')
          .update({ scoutbook_requirement_number: update.scoutbook_requirement_number })
          .eq('id', update.id)
      }

      if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= updates.length) {
        console.log(`  Updated ${Math.min(i + BATCH_SIZE, updates.length)} / ${updates.length}`)
      }
    }

    console.log('')
    console.log('Done!')
  }
}

syncScoutbookIds().catch(console.error)
