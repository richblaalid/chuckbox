#!/usr/bin/env npx tsx
/**
 * Compare BSA tables vs new merit_badge_* tables
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Get versions in bsa tables
  const { data: bsaVersions } = await supabase
    .from('bsa_merit_badge_versions')
    .select('id, merit_badge_id, version_year, bsa_merit_badges(name)')
    .order('version_year', { ascending: false })
    .limit(500)

  // Get versions in new tables
  const { data: newVersions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .order('version_year', { ascending: false })
    .limit(500)

  // Create sets to compare
  const bsaSet = new Set(
    bsaVersions?.map((v) => {
      const badge = v.bsa_merit_badges as unknown as { name: string } | null
      return `${badge?.name}|${v.version_year}`
    })
  )

  const newSet = new Set(newVersions?.map((v) => `${v.badge_name}|${v.version_year}`))

  console.log('BSA table versions (sample):', bsaVersions?.length)
  bsaVersions?.slice(0, 10).forEach((v) => {
    const badge = v.bsa_merit_badges as unknown as { name: string } | null
    console.log(`  ${badge?.name} ${v.version_year}`)
  })

  console.log('\nNew table versions (sample):', newVersions?.length)
  newVersions?.slice(0, 10).forEach((v) => {
    console.log(`  ${v.badge_name} ${v.version_year}`)
  })

  // Find versions only in new table (candidates for syncing)
  const newOnly = [...newSet].filter((v) => {
    return bsaSet.has(v) === false
  })
  console.log('\nVersions in new table but NOT in BSA table:', newOnly.length)
  newOnly.slice(0, 30).forEach((v) => console.log('  ' + v))

  // Find versions only in BSA table
  const bsaOnly = [...bsaSet].filter((v) => {
    return newSet.has(v) === false
  })
  console.log('\nVersions in BSA table but NOT in new table:', bsaOnly.length)
  bsaOnly.slice(0, 30).forEach((v) => console.log('  ' + v))

  // Count totals
  const { count: totalBsaVersions } = await supabase
    .from('bsa_merit_badge_versions')
    .select('*', { count: 'exact', head: true })

  const { count: totalNewVersions } = await supabase
    .from('merit_badge_versions')
    .select('*', { count: 'exact', head: true })

  console.log('\nTotal BSA versions:', totalBsaVersions)
  console.log('Total new versions:', totalNewVersions)
}

main().catch(console.error)
