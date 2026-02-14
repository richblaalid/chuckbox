/**
 * Delete test auth users (ones with + in the email)
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('Finding test auth users to delete...\n')

  const { data: { users } } = await supabase.auth.admin.listUsers()

  const testUsers = users?.filter(u => u.email?.includes('+')) || []

  console.log(`Found ${testUsers.length} test users to delete:`)
  for (const u of testUsers) {
    console.log(`  - ${u.email}`)
  }

  if (testUsers.length === 0) {
    console.log('No test users to delete.')
    return
  }

  console.log('\nDeleting...')
  for (const u of testUsers) {
    const { error } = await supabase.auth.admin.deleteUser(u.id)
    if (error) {
      console.log(`  Failed to delete ${u.email}: ${error.message}`)
    } else {
      console.log(`  Deleted: ${u.email}`)
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
