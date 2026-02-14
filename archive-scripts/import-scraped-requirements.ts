/**
 * Import Scraped Merit Badge Requirements
 *
 * This script imports the scraped merit badge requirements from Scoutbook
 * into the bsa_merit_badge_requirements and bsa_merit_badge_versions tables.
 *
 * Usage:
 *   npx tsx scripts/import-scraped-requirements.ts [--dry-run] [--clean]
 *
 * Options:
 *   --dry-run  Preview changes without modifying the database
 *   --clean    Delete all existing requirements and versions before import
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import type { Database } from '@/types/database'

// Types for scraped data
interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadge {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  totalBadges: number
  completedBadges: number
  currentBadge: string
  badges: ScrapedBadge[]
}

// Badge name normalization map
const BADGE_NAME_TO_CODE: Record<string, string> = {
  // Handle abbreviations and variations
  'environmental science': 'environmental_science',
  'citizenship in the community': 'citizenship_in_community',
  'citizenship in the nation': 'citizenship_in_nation',
  'citizenship in the world': 'citizenship_in_world',
  'citizenship in society': 'citizenship_in_society',
  'personal fitness': 'personal_fitness',
  'personal management': 'personal_management',
  'first aid': 'first_aid',
  'family life': 'family_life',
  'emergency preparedness': 'emergency_preparedness',
  'public health': 'public_health',
  'crime prevention': 'crime_prevention',
  'traffic safety': 'traffic_safety',
  'fire safety': 'fire_safety',
  'water sports': 'water_sports',
  'snow sports': 'snow_sports',
  'american business': 'american_business',
  'american cultures': 'american_cultures',
  'american heritage': 'american_heritage',
  'american labor': 'american_labor',
  'american indian culture': 'american_indian_culture',
  'animal science': 'animal_science',
  'composite materials': 'composite_materials',
  'digital technology': 'digital_technology',
  'disability awareness': 'disability_awareness',
  'fish and wildlife management': 'fish_and_wildlife_management',
  'game design': 'game_design',
  'graphic arts': 'graphic_arts',
  'insect study': 'insect_study',
  'lawn care': 'lawn_care',
  'movie making': 'movie_making',
  'nuclear science': 'nuclear_science',
  'plant science': 'plant_science',
  'public speaking': 'public_speaking',
  'rifle shooting': 'rifle_shooting',
  'shotgun shooting': 'shotgun_shooting',
  'signs signals and codes': 'signs_signals_codes',
  'small boat sailing': 'small_boat_sailing',
  'soil and water conservation': 'soil_water_conservation',
  'space exploration': 'space_exploration',
  'stamp collecting': 'stamp_collecting',
  'wilderness survival': 'wilderness_survival',
  'wood carving': 'wood_carving',
}

function normalizeBadgeCode(badgeName: string): string {
  const lower = badgeName.toLowerCase().trim()
  return (
    BADGE_NAME_TO_CODE[lower] ||
    lower
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  )
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const cleanFirst = args.includes('--clean')

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n')
  }
  if (cleanFirst) {
    console.log('CLEAN MODE - Will delete existing requirements and versions before import\n')
  }

  // Load scraped data
  const dataPath = path.join(process.cwd(), 'data', 'merit-badge-requirements-scraped.json')
  if (!fs.existsSync(dataPath)) {
    console.error(`Scraped data not found at: ${dataPath}`)
    console.error('Run the scraper first: npx tsx scripts/scrape-all-merit-badges.ts')
    process.exit(1)
  }

  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  console.log(`Loaded ${scrapedData.badges.length} badge versions from scraped data\n`)

  // Initialize Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey)

  // Get all existing merit badges
  const { data: existingBadges, error: badgesError } = await supabase
    .from('bsa_merit_badges')
    .select('id, code, name, requirement_version_year')

  if (badgesError) {
    console.error('Error fetching existing badges:', badgesError)
    process.exit(1)
  }

  console.log(`Found ${existingBadges?.length || 0} existing badges in database\n`)

  // Clean existing data if requested
  if (cleanFirst && !dryRun) {
    console.log('Cleaning existing data...')

    // Delete requirements first (child table)
    const { error: reqDeleteError } = await supabase
      .from('bsa_merit_badge_requirements')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all (workaround for no WHERE)

    if (reqDeleteError) {
      console.error('Error deleting requirements:', reqDeleteError.message)
    } else {
      console.log(`  Deleted existing requirements`)
    }

    // Delete versions
    const { error: versionDeleteError } = await supabase
      .from('bsa_merit_badge_versions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (versionDeleteError) {
      console.error('Error deleting versions:', versionDeleteError.message)
    } else {
      console.log(`  Deleted existing versions`)
    }

    console.log('Cleanup complete.\n')
  } else if (cleanFirst && dryRun) {
    console.log('Would delete all existing requirements and versions\n')
  }

  // Create a map of badge code -> badge record
  const badgeMap = new Map<string, typeof existingBadges[0]>()
  for (const badge of existingBadges || []) {
    badgeMap.set(badge.code, badge)
  }

  // Group scraped badges by badge name
  const badgeVersions = new Map<string, ScrapedBadge[]>()
  for (const scraped of scrapedData.badges) {
    const code = normalizeBadgeCode(scraped.badgeName)
    if (!badgeVersions.has(code)) {
      badgeVersions.set(code, [])
    }
    badgeVersions.get(code)!.push(scraped)
  }

  // Stats
  let badgesCreated = 0
  let badgesUpdated = 0
  let versionsCreated = 0
  let requirementsCreated = 0
  let requirementsUpdated = 0
  const unmatchedBadges: string[] = []

  // Process each unique badge
  for (const [code, versions] of badgeVersions) {
    const existingBadge = badgeMap.get(code)
    const latestVersion = versions.reduce((a, b) => (a.versionYear > b.versionYear ? a : b))

    console.log(`\nProcessing: ${latestVersion.badgeName} (${versions.length} versions)`)

    let badgeId: string

    if (!existingBadge) {
      // Badge doesn't exist - create it
      console.log(`  Creating new badge: ${code}`)

      if (!dryRun) {
        const { data: newBadge, error: createError } = await supabase
          .from('bsa_merit_badges')
          .insert({
            code,
            name: latestVersion.badgeName,
            requirement_version_year: latestVersion.versionYear,
            is_eagle_required: false,
            is_active: true,
          })
          .select('id')
          .single()

        if (createError) {
          console.error(`  Error creating badge: ${createError.message}`)
          unmatchedBadges.push(latestVersion.badgeName)
          continue
        }

        badgeId = newBadge.id
        badgesCreated++
      } else {
        badgeId = 'dry-run-id'
        badgesCreated++
      }
    } else {
      badgeId = existingBadge.id
      badgesUpdated++
    }

    // Process each version of this badge
    for (const scraped of versions) {
      const isActive = scraped.versionLabel.includes('(Active)')
      console.log(`  Version ${scraped.versionYear} (${isActive ? 'Active' : 'Past'})`)

      // Create or update version record
      if (!dryRun) {
        const { error: versionError } = await supabase
          .from('bsa_merit_badge_versions')
          .upsert(
            {
              merit_badge_id: badgeId,
              version_year: scraped.versionYear,
              is_current: isActive,
              source: 'scoutbook',
              scraped_at: new Date().toISOString(),
            },
            {
              onConflict: 'merit_badge_id,version_year',
            }
          )

        if (versionError) {
          console.error(`    Error creating version: ${versionError.message}`)
        } else {
          versionsCreated++
        }
      } else {
        versionsCreated++
      }

      // Build parent ID map for this version
      const parentIdMap = new Map<string, string>()

      // Process requirements in order (parents first due to depth sorting)
      const sortedReqs = [...scraped.requirements].sort((a, b) => a.depth - b.depth)

      for (const req of sortedReqs) {
        // Find parent ID if this is a sub-requirement
        let parentReqId: string | null = null
        if (req.parentNumber) {
          parentReqId = parentIdMap.get(req.parentNumber) || null
        }

        // Determine if this is an alternative (Option A/B)
        const isAlternative = /^\d+[A-Z]/.test(req.number)
        const alternativesGroup = isAlternative
          ? req.number.match(/^\d+/)?.[0] + '_options'
          : null

        if (!dryRun) {
          // Try to find existing requirement
          const { data: existing } = await supabase
            .from('bsa_merit_badge_requirements')
            .select('id')
            .eq('merit_badge_id', badgeId)
            .eq('version_year', scraped.versionYear)
            .eq('scoutbook_requirement_number', req.number)
            .maybeSingle()

          if (existing) {
            // Update existing
            const { error: updateError } = await supabase
              .from('bsa_merit_badge_requirements')
              .update({
                description: req.description,
                parent_requirement_id: parentReqId,
                nesting_depth: req.depth,
                is_alternative: isAlternative,
                alternatives_group: alternativesGroup,
              })
              .eq('id', existing.id)

            if (updateError) {
              console.error(`    Error updating req ${req.number}: ${updateError.message}`)
            } else {
              parentIdMap.set(req.number, existing.id)
              requirementsUpdated++
            }
          } else {
            // Create new
            const { data: newReq, error: createError } = await supabase
              .from('bsa_merit_badge_requirements')
              .insert({
                merit_badge_id: badgeId,
                version_year: scraped.versionYear,
                requirement_number: req.number,
                scoutbook_requirement_number: req.number,
                description: req.description,
                parent_requirement_id: parentReqId,
                display_order: sortedReqs.indexOf(req),
                nesting_depth: req.depth,
                is_alternative: isAlternative,
                alternatives_group: alternativesGroup,
              })
              .select('id')
              .single()

            if (createError) {
              console.error(`    Error creating req ${req.number}: ${createError.message}`)
            } else {
              parentIdMap.set(req.number, newReq.id)
              requirementsCreated++
            }
          }
        } else {
          parentIdMap.set(req.number, `dry-run-${req.number}`)
          requirementsCreated++
        }
      }

      console.log(`    ${scraped.requirements.length} requirements processed`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('IMPORT SUMMARY')
  console.log('='.repeat(60))
  console.log(`Badges created:      ${badgesCreated}`)
  console.log(`Badges updated:      ${badgesUpdated}`)
  console.log(`Versions created:    ${versionsCreated}`)
  console.log(`Requirements created: ${requirementsCreated}`)
  console.log(`Requirements updated: ${requirementsUpdated}`)

  if (unmatchedBadges.length > 0) {
    console.log(`\nUnmatched badges (${unmatchedBadges.length}):`)
    for (const name of unmatchedBadges) {
      console.log(`  - ${name}`)
    }
  }

  if (dryRun) {
    console.log('\n(This was a dry run - no changes were made)')
  }
}

main().catch(console.error)
