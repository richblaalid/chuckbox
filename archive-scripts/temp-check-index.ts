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

async function check() {
  console.log('Checking on:', process.env.NEXT_PUBLIC_SUPABASE_URL)
  
  // Check actual counts
  const { count } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
  console.log('Total requirements:', count)
  
  // Check depth distribution
  for (let d = 0; d <= 3; d++) {
    const { count: c } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('*', { count: 'exact', head: true })
      .eq('nesting_depth', d)
    console.log('  Depth', d + ':', c)
  }
  
  // Check with parent
  const { count: withParent } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .not('parent_requirement_id', 'is', null)
  console.log('With parent:', withParent)
}

check()
