/**
 * Import staged roster data for a provisioned unit.
 *
 * Usage: npx tsx scripts/import-staged-roster.ts <email>
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const email = process.argv[2]

if (!email) {
  console.error('Usage: npx tsx scripts/import-staged-roster.ts <email>')
  process.exit(1)
}

interface ParsedAdult {
  bsaId: string
  firstName: string
  lastName: string
  email?: string
  phoneHome?: string
  phoneMobile?: string
  position?: string
}

interface ParsedScout {
  bsaId: string
  firstName: string
  lastName: string
  patrol?: string
  rank?: string
  dateOfBirth?: string
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log(`Looking up staged roster for email: ${email}`)

  // Find the provisioning token by email
  const { data: token, error: tokenError } = await supabase
    .from('unit_provisioning_tokens')
    .select('id, unit_id, profile_id')
    .eq('email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (tokenError || !token) {
    console.error('No provisioning token found for email:', email)
    process.exit(1)
  }

  console.log('Found provisioning token:', token.id)
  console.log('Unit ID:', token.unit_id)

  // Get staged roster data
  const { data: stagedData, error: stagedError } = await supabase
    .from('staged_roster_imports')
    .select('*')
    .eq('provisioning_token_id', token.id)
    .maybeSingle()

  if (stagedError || !stagedData) {
    console.error('No staged roster data found')
    console.error(stagedError)
    process.exit(1)
  }

  const adults = stagedData.parsed_adults as ParsedAdult[]
  const scouts = stagedData.parsed_scouts as ParsedScout[]

  console.log(`Found ${adults.length} adults and ${scouts.length} scouts to import`)

  const unitId = token.unit_id
  let adultsImported = 0
  let scoutsImported = 0
  let patrolsCreated = 0

  // Map to track BSA ID -> profile ID for guardian linking
  const bsaIdToProfileId = new Map<string, string>()

  // Map to track patrol name -> patrol id
  const patrolNameToId = new Map<string, string>()

  // ============================================
  // Create missing patrols
  // ============================================
  const patrolNames = new Set<string>()
  for (const scout of scouts) {
    if (scout.patrol) {
      patrolNames.add(scout.patrol)
    }
  }

  if (patrolNames.size > 0) {
    console.log(`\nCreating ${patrolNames.size} patrols...`)

    // Get existing patrols for this unit
    const { data: existingPatrols } = await supabase
      .from('patrols')
      .select('id, name')
      .eq('unit_id', unitId)

    for (const patrol of existingPatrols || []) {
      patrolNameToId.set(patrol.name.toLowerCase(), patrol.id)
    }

    // Get max display_order for new patrols
    let maxOrder = 0
    if (existingPatrols && existingPatrols.length > 0) {
      const { data: maxOrderData } = await supabase
        .from('patrols')
        .select('display_order')
        .eq('unit_id', unitId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single()

      maxOrder = maxOrderData?.display_order || 0
    }

    // Create new patrols
    for (const patrolName of patrolNames) {
      if (!patrolNameToId.has(patrolName.toLowerCase())) {
        maxOrder++
        const { data: newPatrol, error: patrolError } = await supabase
          .from('patrols')
          .insert({
            unit_id: unitId,
            name: patrolName,
            display_order: maxOrder,
            is_active: true,
          })
          .select('id')
          .single()

        if (!patrolError && newPatrol) {
          patrolNameToId.set(patrolName.toLowerCase(), newPatrol.id)
          patrolsCreated++
          console.log(`   Created patrol: ${patrolName}`)
        }
      }
    }
  }

  // ============================================
  // Import adults as unit_memberships
  // ============================================
  console.log(`\nImporting ${adults.length} adults...`)

  for (const adult of adults) {
    // Skip if BSA ID already exists
    const { data: existingMember } = await supabase
      .from('unit_memberships')
      .select('id')
      .eq('unit_id', unitId)
      .eq('bsa_member_id', adult.bsaId)
      .maybeSingle()

    if (existingMember) {
      console.log(`   Skipping ${adult.firstName} ${adult.lastName} - already exists`)
      continue
    }

    // Create a profile for this adult
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        first_name: adult.firstName,
        last_name: adult.lastName,
        full_name: `${adult.firstName} ${adult.lastName}`,
        email: adult.email?.toLowerCase() || null,
        phone_home: adult.phoneHome || null,
        phone_mobile: adult.phoneMobile || null,
        position: adult.position || null,
      })
      .select('id')
      .single()

    if (profileError || !profile) {
      console.error(`   Failed to create profile for ${adult.firstName} ${adult.lastName}:`, profileError)
      continue
    }

    bsaIdToProfileId.set(adult.bsaId, profile.id)

    // Determine role based on position
    let role = 'leader'
    const position = adult.position?.toLowerCase() || ''
    if (position.includes('committee') || position.includes('chair')) {
      role = 'leader'
    } else if (position.includes('parent') || position.includes('guardian')) {
      role = 'parent'
    }

    // Create unit membership
    const { error: membershipError } = await supabase
      .from('unit_memberships')
      .insert({
        unit_id: unitId,
        profile_id: profile.id,
        role: role,
        status: 'invited',
        bsa_member_id: adult.bsaId,
        position_title: adult.position || null,
        email: adult.email?.toLowerCase() || null,
      })

    if (!membershipError) {
      adultsImported++
      console.log(`   Imported: ${adult.firstName} ${adult.lastName} (${adult.position || 'no position'})`)
    } else {
      console.error(`   Failed to create membership for ${adult.firstName} ${adult.lastName}:`, membershipError)
    }
  }

  // ============================================
  // Import scouts
  // ============================================
  console.log(`\nImporting ${scouts.length} scouts...`)

  for (const scout of scouts) {
    // Skip if BSA ID already exists
    const { data: existingScout } = await supabase
      .from('scouts')
      .select('id')
      .eq('unit_id', unitId)
      .eq('bsa_member_id', scout.bsaId)
      .maybeSingle()

    if (existingScout) {
      console.log(`   Skipping ${scout.firstName} ${scout.lastName} - already exists`)
      continue
    }

    // Get patrol ID if specified
    let patrolId = null
    if (scout.patrol) {
      patrolId = patrolNameToId.get(scout.patrol.toLowerCase()) || null
    }

    // Create scout
    const { error: scoutError } = await supabase
      .from('scouts')
      .insert({
        unit_id: unitId,
        first_name: scout.firstName,
        last_name: scout.lastName,
        bsa_member_id: scout.bsaId,
        patrol_id: patrolId,
        rank: scout.rank || null,
        date_of_birth: scout.dateOfBirth || null,
        is_active: true,
      })

    if (!scoutError) {
      scoutsImported++
      console.log(`   Imported: ${scout.firstName} ${scout.lastName} (${scout.patrol || 'no patrol'})`)
    } else {
      console.error(`   Failed to import ${scout.firstName} ${scout.lastName}:`, scoutError)
    }
  }

  console.log(`\n========================================`)
  console.log(`Import complete!`)
  console.log(`   Adults imported: ${adultsImported}`)
  console.log(`   Scouts imported: ${scoutsImported}`)
  console.log(`   Patrols created: ${patrolsCreated}`)
  console.log(`========================================`)

  // Clean up staged data
  console.log('\nCleaning up staged roster data...')
  await supabase
    .from('staged_roster_imports')
    .delete()
    .eq('id', stagedData.id)

  console.log('Done!')
}

main().catch(console.error)
