import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // Check Camping badge requirements in DB
  const { data: campingBadge, error: badgeErr } = await supabase
    .from('bsa_merit_badges')
    .select('id, code')
    .eq('code', 'camping')
    .single()

  console.log('Badge:', campingBadge, 'Error:', badgeErr)

  const { data: reqs, error: reqsErr } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_requirement_number, original_scoutbook_id, version_year')
    .eq('merit_badge_id', campingBadge!.id)
    .order('requirement_number')

  console.log('Reqs error:', reqsErr)
  console.log('Camping badge requirements in DB (first 50):')
  if (reqs) {
    reqs.slice(0, 50).forEach(r => console.log('  ', r.requirement_number, '| SB:', r.scoutbook_requirement_number, '| orig:', r.original_scoutbook_id, '| ver:', r.version_year))
  }

  // Check First Aid
  const { data: firstAidBadge } = await supabase
    .from('bsa_merit_badges')
    .select('id, code')
    .eq('code', 'first_aid')
    .single()

  const { data: faReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_requirement_number')
    .eq('merit_badge_id', firstAidBadge!.id)
    .order('requirement_number')

  console.log('\nFirst Aid badge requirements in DB (first 50):')
  faReqs?.slice(0, 50).forEach(r => console.log('  ', r.requirement_number, '| SB:', r.scoutbook_requirement_number))

  // Check Emergency Preparedness
  const { data: epBadge } = await supabase
    .from('bsa_merit_badges')
    .select('id, code')
    .eq('code', 'emergency_preparedness')
    .single()

  const { data: epReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_requirement_number')
    .eq('merit_badge_id', epBadge!.id)
    .order('requirement_number')

  console.log('\nEmergency Preparedness badge requirements in DB (first 50):')
  epReqs?.slice(0, 50).forEach(r => console.log('  ', r.requirement_number, '| SB:', r.scoutbook_requirement_number))
}

main()
