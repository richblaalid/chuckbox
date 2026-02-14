/**
 * Check signup state - units, tokens, and auth users
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('Checking signup state...\n')

  // Check units
  const { data: units } = await supabase
    .from('units')
    .select('id, name, unit_number, council, provisioning_status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('Recent units:', units?.length || 0)
  if (units?.length) {
    for (const u of units) {
      console.log(`  - ${u.name} (${u.council}) - status: ${u.provisioning_status}`)
    }
  }

  // Check provisioning tokens
  const { data: tokens } = await supabase
    .from('unit_provisioning_tokens')
    .select('id, email, verified_at, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('\nProvisioning tokens:', tokens?.length || 0)
  if (tokens?.length) {
    for (const t of tokens) {
      console.log(`  - ${t.email} - verified: ${t.verified_at ? 'yes' : 'no'}, expires: ${t.expires_at}`)
    }
  }

  // Check rate limits
  const { data: rateLimits } = await supabase
    .from('signup_rate_limits')
    .select('*')
    .order('last_attempt_at', { ascending: false })
    .limit(5)

  console.log('\nRate limits:', rateLimits?.length || 0)
  if (rateLimits?.length) {
    for (const r of rateLimits) {
      console.log(`  - IP: ${r.ip_address}, email: ${r.email}, attempts: ${r.attempts}, blocked: ${r.blocked_until || 'no'}`)
    }
  }

  // Check auth users
  const { data: { users } } = await supabase.auth.admin.listUsers()
  console.log('\nAuth users:', users?.length || 0)
  if (users?.length) {
    for (const u of users) {
      console.log(`  - ${u.email} - created: ${u.created_at}, confirmed: ${u.email_confirmed_at ? 'yes' : 'no'}`)
    }
  }

  // Check staged roster imports
  const { data: staged } = await supabase
    .from('staged_roster_imports')
    .select('id, provisioning_token_id, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('\nStaged roster imports:', staged?.length || 0)
}

main().catch(console.error)
