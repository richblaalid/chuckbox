import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

async function main() {
  // Find Archery badge
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id, name')
    .eq('name', 'Archery')
    .single()
  
  if (!badge) {
    console.log('Archery badge not found')
    return
  }
  
  console.log('Badge:', badge.name, 'ID:', badge.id)
  
  // Get 2025 version
  const { data: version } = await supabase
    .from('bsa_merit_badge_versions')
    .select('id, version_year')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2025)
    .single()
  
  if (!version) {
    console.log('Archery v2025 not found')
    return
  }
  
  console.log('Version:', version.version_year, 'ID:', version.id)
  console.log()
  
  // Get requirement 5 and its descendants
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_id, is_header, nesting_depth, parent_id, description')
    .eq('version_id', version.id)
    .like('requirement_number', '5%')
    .order('display_order')
  
  console.log('Requirement 5 tree (', reqs?.length, 'items):')
  console.log('='.repeat(80))
  
  for (const r of reqs || []) {
    const indent = '  '.repeat(r.nesting_depth - 1)
    const marker = r.is_header ? '[H]' : '   '
    const parentInfo = r.parent_id ? '(has parent)' : '(ROOT)'
    console.log(`${indent}${marker} ${r.requirement_number} (depth:${r.nesting_depth}) ${parentInfo}`)
    console.log(`${indent}    scoutbook_id: ${r.scoutbook_id}`)
  }
}

main()
