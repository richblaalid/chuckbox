/**
 * Clear provisioning tables
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('Clearing provisioning tables...')

  await supabase.from('staged_roster_imports').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('  Cleared: staged_roster_imports')

  await supabase.from('unit_provisioning_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('  Cleared: unit_provisioning_tokens')

  await supabase.from('signup_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('  Cleared: signup_rate_limits')

  console.log('Done!')
}

main().catch(console.error)
