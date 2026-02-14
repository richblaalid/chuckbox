import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Check merit_badge_requirements for Emergency Preparedness
  const { data: versions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .eq('badge_name', 'Emergency Preparedness')
  
  console.log('Emergency Preparedness versions:', versions?.map(v => v.version_year).join(', '))
  
  if (versions && versions.length > 0) {
    const { data: reqs } = await supabase
      .from('merit_badge_requirements')
      .select('scoutbook_id')
      .eq('badge_version_id', versions[0].id)
      .order('sort_order')
      .limit(30)
    
    console.log(`\nRequirements for ${versions[0].version_year}:`)
    console.log(reqs?.map(r => r.scoutbook_id).join(', '))
  }
}

check()
