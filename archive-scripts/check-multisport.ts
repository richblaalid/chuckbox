import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id, name')
    .eq('name', 'Multisport')
    .single()
  
  if (!badge) {
    console.log('Badge not found')
    return
  }
  
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('requirement_number, description, parent_requirement_id, display_order')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2026)
    .order('display_order')
  
  console.log('Multisport 2026 in DB (requirement 4 section):')
  console.log('='.repeat(60))
  
  const req4Idx = reqs?.findIndex(r => r.requirement_number === '4') || 0
  
  for (const req of (reqs || []).slice(req4Idx, req4Idx + 45)) {
    const hasParent = req.parent_requirement_id ? ' [has parent]' : ''
    console.log('[' + req.requirement_number + ']' + hasParent)
    console.log('  "' + req.description.substring(0, 55) + '..."')
  }
}

check()
