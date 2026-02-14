#!/usr/bin/env npx tsx
/**
 * Clear progress records and requirements for specific ranks in a version.
 * This allows re-seeding with clean data.
 *
 * Usage:
 *   npx tsx scripts/clear-rank-progress.ts                    # Target active version
 *   npx tsx scripts/clear-rank-progress.ts --version=2025     # Target specific version
 *   npx tsx scripts/clear-rank-progress.ts --all-ranks        # Clear all ranks, not just problem ones
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Detect --prod flag for environment switching
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

// Display which environment we're using
const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Parse arguments
  const versionArg = process.argv.find(a => a.startsWith('--version='))
  const targetYear = versionArg ? parseInt(versionArg.split('=')[1]) : null
  const allRanks = process.argv.includes('--all-ranks')

  let targetVersion: { id: string; version_year: number; is_active: boolean }

  if (targetYear) {
    const { data } = await supabase
      .from('bsa_requirement_versions')
      .select('id, version_year, is_active')
      .eq('version_year', targetYear)
      .single()

    if (!data) {
      console.error('Version year ' + targetYear + ' not found')
      process.exit(1)
    }
    targetVersion = data
  } else {
    const { data } = await supabase
      .from('bsa_requirement_versions')
      .select('id, version_year, is_active')
      .eq('is_active', true)
      .single()

    if (!data) {
      console.error('No active version found')
      process.exit(1)
    }
    targetVersion = data
  }

  console.log('Target version:', targetVersion.version_year, '(' + targetVersion.id + ')')
  console.log('  Active:', targetVersion.is_active)
  console.log()

  // Ranks to clean - default to problem ranks, or all if --all-ranks
  const rankCodes = allRanks
    ? ['scout', 'tenderfoot', 'second_class', 'first_class', 'star', 'life', 'eagle']
    : ['scout', 'tenderfoot', 'second_class']

  console.log('Ranks to clear:', rankCodes.join(', '))
  console.log()

  for (const code of rankCodes) {
    const { data: rank } = await supabase
      .from('bsa_ranks')
      .select('id, name')
      .eq('code', code)
      .single()

    if (!rank) {
      console.log('Rank not found:', code)
      continue
    }

    // Get requirement IDs for this rank/version
    const { data: reqs } = await supabase
      .from('bsa_rank_requirements')
      .select('id')
      .eq('rank_id', rank.id)
      .eq('version_id', targetVersion.id)

    const reqIds = reqs?.map(r => r.id) || []
    console.log(rank.name + ': ' + reqIds.length + ' requirements to clear')

    // Delete progress records for these requirements
    if (reqIds.length > 0) {
      const { error: progError } = await supabase
        .from('scout_rank_requirement_progress')
        .delete()
        .in('requirement_id', reqIds)

      if (progError) {
        console.log('  Error deleting progress:', progError.message)
      } else {
        console.log('  ✓ Deleted progress records')
      }
    }

    // Delete the requirements
    const { error: reqError } = await supabase
      .from('bsa_rank_requirements')
      .delete()
      .eq('rank_id', rank.id)
      .eq('version_id', targetVersion.id)

    if (reqError) {
      console.log('  Error deleting requirements:', reqError.message)
    } else {
      console.log('  ✓ Deleted requirements')
    }
  }

  console.log()
  console.log('Done. Now run: npx tsx scripts/seed-rank-requirements.ts' + (targetYear ? ' --version=' + targetYear : ''))
}

main().catch(console.error)
