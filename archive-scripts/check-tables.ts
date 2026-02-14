import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Check merit_badge_requirements table
  const { data: mbr, count: mbrCount } = await supabase
    .from('merit_badge_requirements')
    .select('scoutbook_id, badge_version_id', { count: 'exact' })
    .limit(10)
  
  console.log('merit_badge_requirements count:', mbrCount)
  console.log('Sample scoutbook_ids:', mbr?.map(r => r.scoutbook_id).join(', '))
  
  // Check bsa_merit_badge_requirements table  
  const { data: bsaReq, count: bsaCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_requirement_number', { count: 'exact' })
    .limit(10)
  
  console.log('')
  console.log('bsa_merit_badge_requirements count:', bsaCount)
  console.log('Sample requirement_numbers:', bsaReq?.map(r => r.requirement_number + ' | SB:' + r.scoutbook_requirement_number).join(', '))
}

check()
