import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Check Personal Management 2019
  const { data: pmBadge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('code', 'personal_management')
    .single()

  if (!pmBadge) return

  // Get all requirements for Personal Management 2019
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, scoutbook_requirement_number')
    .eq('merit_badge_id', pmBadge.id)
    .eq('version_year', 2019)
    .order('requirement_number')

  console.log('Personal Management 2019 requirements:', reqs?.length)
  console.log('First 20:')
  reqs?.slice(0, 20).forEach(r => {
    console.log('  req_num: ' + r.requirement_number + ' | sb_req_num: ' + r.scoutbook_requirement_number)
  })

  // Check for potential duplicates - same base requirement
  const seen = new Map()
  const duplicates: string[] = []
  reqs?.forEach(r => {
    // Normalize to find duplicates: "2(1)" and "2b[1]" should be considered same
    const normalized = r.requirement_number.replace(/\[|\]/g, '(').replace(/\)/g, ')')
    if (seen.has(normalized)) {
      duplicates.push(r.requirement_number + ' vs ' + seen.get(normalized))
    } else {
      seen.set(normalized, r.requirement_number)
    }
  })

  console.log('\nPotential duplicates:', duplicates.length)
  duplicates.slice(0, 10).forEach(d => console.log('  ' + d))
}

check()
