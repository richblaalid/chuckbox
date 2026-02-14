/**
 * Fix a pending unit that was created during signup but verification
 * redirected to production instead of localhost.
 *
 * Usage: npx tsx scripts/fix-pending-unit.ts <email>
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const email = process.argv[2]

if (!email) {
  console.error('Usage: npx tsx scripts/fix-pending-unit.ts <email>')
  process.exit(1)
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log(`Looking up provisioning for email: ${email}`)

  // Find the provisioning token by email
  const { data: token, error: tokenError } = await supabase
    .from('unit_provisioning_tokens')
    .select('*, units(id, name, provisioning_status), profiles(id, user_id)')
    .eq('email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (tokenError || !token) {
    console.error('No provisioning token found for email:', email)
    console.error(tokenError)
    process.exit(1)
  }

  console.log('Found provisioning token:', token.id)
  console.log('Unit:', (token.units as any)?.name, '- Status:', (token.units as any)?.provisioning_status)
  console.log('Profile:', token.profile_id, '- User ID:', (token.profiles as any)?.user_id)

  // Find the user by email
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()
  const user = users?.find(u => u.email?.toLowerCase() === email.toLowerCase())

  if (!user) {
    console.error('No auth user found for email:', email)
    process.exit(1)
  }

  console.log('Found auth user:', user.id)

  // 1. Link profile to user
  console.log('\n1. Linking profile to user...')
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ user_id: user.id })
    .eq('id', token.profile_id)

  if (profileError) {
    console.error('Failed to link profile:', profileError)
  } else {
    console.log('   Profile linked!')
  }

  // 2. Activate unit
  console.log('2. Activating unit...')
  const { error: unitError } = await supabase
    .from('units')
    .update({ provisioning_status: 'active' })
    .eq('id', token.unit_id)

  if (unitError) {
    console.error('Failed to activate unit:', unitError)
  } else {
    console.log('   Unit activated!')
  }

  // 3. Activate membership
  console.log('3. Activating membership...')
  const { error: membershipError } = await supabase
    .from('unit_memberships')
    .update({ status: 'active' })
    .eq('unit_id', token.unit_id)
    .eq('profile_id', token.profile_id)

  if (membershipError) {
    console.error('Failed to activate membership:', membershipError)
  } else {
    console.log('   Membership activated!')
  }

  // 4. Mark token as verified
  console.log('4. Marking token as verified...')
  const { error: verifyError } = await supabase
    .from('unit_provisioning_tokens')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', token.id)

  if (verifyError) {
    console.error('Failed to verify token:', verifyError)
  } else {
    console.log('   Token verified!')
  }

  // 5. Import staged roster if exists
  console.log('5. Checking for staged roster...')
  const { data: stagedData } = await supabase
    .from('staged_roster_imports')
    .select('*')
    .eq('provisioning_token_id', token.id)
    .maybeSingle()

  if (stagedData) {
    console.log('   Found staged roster data - importing...')
    const adults = stagedData.parsed_adults as any[]
    const scouts = stagedData.parsed_scouts as any[]
    console.log(`   ${adults?.length || 0} adults, ${scouts?.length || 0} scouts to import`)
    // Note: Full import logic would go here, but for now just log
    console.log('   (Roster import requires running the full import action)')
  } else {
    console.log('   No staged roster data found')
  }

  console.log('\nDone! User should now be able to sign in and access the unit.')
}

main().catch(console.error)
