#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function verify() {
  // Count versions
  const { count: versionCount } = await supabase
    .from('merit_badge_versions')
    .select('*', { count: 'exact', head: true })

  // Count requirements
  const { count: reqCount } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  // Eagle required badges
  const { data: eagle } = await supabase
    .from('merit_badge_versions')
    .select('badge_name, version_year, requirement_count')
    .eq('is_eagle_required', true)
    .order('badge_name')
    .limit(10)

  // Sample Multisport data
  const { data: multisport } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year, requirement_count, id_format')
    .eq('badge_name', 'Multisport')

  const msVersion = multisport?.[0]
  let sampleReqs: any[] = []
  if (msVersion) {
    const { data } = await supabase
      .from('merit_badge_requirements')
      .select('scoutbook_id, main_req, option_name, section, item')
      .eq('badge_version_id', msVersion.id)
      .limit(10)
    sampleReqs = data || []
  }

  console.log('='.repeat(60))
  console.log('DATABASE VERIFICATION')
  console.log('='.repeat(60))
  console.log('Total badge versions:', versionCount)
  console.log('Total requirements:', reqCount)
  console.log('')
  console.log('Sample Eagle-required badges:')
  eagle?.forEach(b => console.log(`  ${b.badge_name} ${b.version_year} (${b.requirement_count} reqs)`))
  console.log('')
  console.log('Multisport versions:')
  multisport?.forEach(m => console.log(`  ${m.version_year}: ${m.requirement_count} reqs (${m.id_format})`))
  console.log('')
  console.log('Sample Multisport requirements:')
  sampleReqs.forEach(r => console.log(`  ${r.scoutbook_id} | opt: ${r.option_name || '-'} | sec: ${r.section || '-'} | item: ${r.item || '-'}`))
}

verify().catch(console.error)
