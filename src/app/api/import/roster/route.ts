import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  type ParsedAdult,
  type ParsedScout,
  deriveRole,
  getScoutPosition,
} from '@/lib/import/bsa-roster-parser'

interface ImportRequest {
  adults: ParsedAdult[]
  scouts: ParsedScout[]
}

interface ImportResult {
  success: boolean
  adultsImported: number
  adultsUpdated: number
  scoutsImported: number
  scoutsUpdated: number
  guardiansLinked: number
  trainingsImported: number
  patrolsCreated: number
  errors: string[]
}

export async function POST(request: NextRequest): Promise<NextResponse<ImportResult>> {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, adultsImported: 0, adultsUpdated: 0, scoutsImported: 0, scoutsUpdated: 0, guardiansLinked: 0, trainingsImported: 0, patrolsCreated: 0, errors: ['Unauthorized'] },
      { status: 401 }
    )
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json(
      { success: false, adultsImported: 0, adultsUpdated: 0, scoutsImported: 0, scoutsUpdated: 0, guardiansLinked: 0, trainingsImported: 0, patrolsCreated: 0, errors: ['Profile not found'] },
      { status: 403 }
    )
  }

  // Get user's unit and verify admin role
  const { data: membership, error: membershipError } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (membershipError || !membership) {
    return NextResponse.json(
      { success: false, adultsImported: 0, adultsUpdated: 0, scoutsImported: 0, scoutsUpdated: 0, guardiansLinked: 0, trainingsImported: 0, patrolsCreated: 0, errors: ['No active unit membership'] },
      { status: 403 }
    )
  }

  if (membership.role !== 'admin' && membership.role !== 'treasurer') {
    return NextResponse.json(
      { success: false, adultsImported: 0, adultsUpdated: 0, scoutsImported: 0, scoutsUpdated: 0, guardiansLinked: 0, trainingsImported: 0, patrolsCreated: 0, errors: ['Only admins and treasurers can import rosters'] },
      { status: 403 }
    )
  }

  const unitId = membership.unit_id

  // Parse request body
  let data: ImportRequest
  try {
    data = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, adultsImported: 0, adultsUpdated: 0, scoutsImported: 0, scoutsUpdated: 0, guardiansLinked: 0, trainingsImported: 0, patrolsCreated: 0, errors: ['Invalid request body'] },
      { status: 400 }
    )
  }

  const { adults, scouts } = data
  const errors: string[] = []
  let adultsImported = 0
  let adultsUpdated = 0
  let scoutsImported = 0
  let scoutsUpdated = 0
  let guardiansLinked = 0
  let trainingsImported = 0
  let patrolsCreated = 0

  // Use admin client for operations that might bypass RLS
  const adminSupabase = createAdminClient()

  // Map to track BSA ID -> profile ID for guardian linking
  const bsaIdToProfileId = new Map<string, string>()

  // Map to track patrol name -> patrol id
  const patrolNameToId = new Map<string, string>()

  // ============================================
  // Create missing patrols
  // ============================================
  // Collect unique patrol names from scouts
  const patrolNames = new Set<string>()
  for (const scout of scouts) {
    if (scout.patrol) {
      patrolNames.add(scout.patrol)
    }
  }

  if (patrolNames.size > 0) {
    // Get existing patrols for this unit
    const { data: existingPatrols } = await adminSupabase
      .from('patrols')
      .select('id, name')
      .eq('unit_id', unitId)

    // Build map of existing patrols
    for (const patrol of existingPatrols || []) {
      patrolNameToId.set(patrol.name.toLowerCase(), patrol.id)
    }

    // Get max display_order for new patrols
    let maxOrder = 0
    if (existingPatrols && existingPatrols.length > 0) {
      const { data: maxOrderData } = await adminSupabase
        .from('patrols')
        .select('display_order')
        .eq('unit_id', unitId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single()

      if (maxOrderData) {
        maxOrder = maxOrderData.display_order ?? 0
      }
    }

    // Create missing patrols
    for (const patrolName of patrolNames) {
      if (!patrolNameToId.has(patrolName.toLowerCase())) {
        maxOrder++
        const { data: newPatrol, error: patrolError } = await adminSupabase
          .from('patrols')
          .insert({
            unit_id: unitId,
            name: patrolName,
            display_order: maxOrder,
            is_active: true,
          })
          .select('id')
          .single()

        if (patrolError) {
          errors.push(`Error creating patrol ${patrolName}: ${patrolError.message}`)
        } else if (newPatrol) {
          patrolNameToId.set(patrolName.toLowerCase(), newPatrol.id)
          patrolsCreated++
        }
      }
    }
  }

  // ============================================
  // Import Adults to profiles table
  // ============================================
  for (const adult of adults) {
    try {
      const fullName = `${adult.firstName} ${adult.lastName}`
      const primaryPosition = adult.positions?.[0] || null

      // Determine member type from positions
      let memberType: 'LEADER' | 'P 18+' = 'P 18+' // Default to parent
      if (adult.positions?.some(p =>
        p.toLowerCase().includes('scoutmaster') ||
        p.toLowerCase().includes('assistant scoutmaster') ||
        p.toLowerCase().includes('committee') ||
        p.toLowerCase().includes('den leader') ||
        p.toLowerCase().includes('cubmaster') ||
        p.toLowerCase().includes('pack trainer')
      )) {
        memberType = 'LEADER'
      }

      // Check for existing profile by BSA ID
      let profileId: string | null = null

      if (adult.bsaMemberId) {
        const { data: existingProfile } = await adminSupabase
          .from('profiles')
          .select('id')
          .eq('bsa_member_id', adult.bsaMemberId)
          .maybeSingle()

        if (existingProfile) {
          profileId = existingProfile.id

          // Update existing profile - include contact info from CSV
          await adminSupabase
            .from('profiles')
            .update({
              first_name: adult.firstName,
              last_name: adult.lastName,
              full_name: fullName,
              email: adult.email?.toLowerCase() || null,
              phone_home: adult.phoneHome || null,
              phone_mobile: adult.phoneMobile || null,
              address_street: adult.address || null,
              address_city: adult.city || null,
              address_state: adult.state || null,
              address_zip: adult.zip || null,
              member_type: memberType,
              position: primaryPosition,
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', profileId)

          // Ensure unit membership exists for the updated profile
          const { data: existingMembership } = await adminSupabase
            .from('unit_memberships')
            .select('id')
            .eq('profile_id', profileId)
            .eq('unit_id', unitId)
            .maybeSingle()

          if (!existingMembership) {
            await adminSupabase.from('unit_memberships').insert({
              unit_id: unitId,
              profile_id: profileId,
              role: memberType === 'LEADER' ? 'leader' : 'parent',
              status: 'roster',
            })
          }

          adultsUpdated++
        }
      }

      // Create new profile if not found
      if (!profileId && adult.bsaMemberId) {
        const { data: newProfile, error: profileError } = await adminSupabase
          .from('profiles')
          .insert({
            bsa_member_id: adult.bsaMemberId,
            first_name: adult.firstName,
            last_name: adult.lastName,
            full_name: fullName,
            email: adult.email?.toLowerCase() || null,
            phone_home: adult.phoneHome || null,
            phone_mobile: adult.phoneMobile || null,
            address_street: adult.address || null,
            address_city: adult.city || null,
            address_state: adult.state || null,
            address_zip: adult.zip || null,
            member_type: memberType,
            position: primaryPosition,
            is_active: true,
            last_synced_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (profileError) {
          errors.push(`Error creating adult profile ${fullName}: ${profileError.message}`)
        } else if (newProfile) {
          profileId = newProfile.id
          adultsImported++

          // Create unit membership for the adult (roster status until invited)
          await adminSupabase
            .from('unit_memberships')
            .insert({
              unit_id: unitId,
              profile_id: profileId,
              role: memberType === 'LEADER' ? 'leader' : 'parent',
              status: 'roster',
            })
        }
      }

      // Track BSA ID for guardian linking
      if (adult.bsaMemberId && profileId) {
        bsaIdToProfileId.set(adult.bsaMemberId, profileId)
      }
    } catch (err) {
      errors.push(`Error importing adult ${adult.firstName} ${adult.lastName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================
  // Import Scouts
  // ============================================
  for (const scout of scouts) {
    try {
      // Check for existing scout by BSA ID
      let scoutId: string | null = null

      if (scout.bsaMemberId) {
        const { data: existingScout } = await adminSupabase
          .from('scouts')
          .select('id')
          .eq('unit_id', unitId)
          .eq('bsa_member_id', scout.bsaMemberId)
          .maybeSingle()

        if (existingScout) {
          scoutId = existingScout.id

          // Update existing scout
          const scoutPositions = getScoutPosition(scout.positions)
          const patrolId = scout.patrol ? patrolNameToId.get(scout.patrol.toLowerCase()) : null
          await adminSupabase
            .from('scouts')
            .update({
              first_name: scout.firstName,
              last_name: scout.lastName,
              rank: scout.rank,
              date_of_birth: scout.dateOfBirth,
              patrol_id: patrolId || null,
              current_position: scoutPositions.primary,
              current_position_2: scoutPositions.secondary,
              updated_at: new Date().toISOString(),
            })
            .eq('id', scoutId)

          scoutsUpdated++
        }
      }

      // Create new scout if not found
      if (!scoutId) {
        // Insert scout
        const scoutPositions = getScoutPosition(scout.positions)
        const patrolId = scout.patrol ? patrolNameToId.get(scout.patrol.toLowerCase()) : null
        const { data: newScout, error: scoutError } = await adminSupabase
          .from('scouts')
          .insert({
            unit_id: unitId,
            first_name: scout.firstName,
            last_name: scout.lastName,
            bsa_member_id: scout.bsaMemberId,
            rank: scout.rank,
            patrol_id: patrolId || null,
            date_of_birth: scout.dateOfBirth,
            current_position: scoutPositions.primary,
            current_position_2: scoutPositions.secondary,
            is_active: true,
          })
          .select('id')
          .single()

        if (scoutError) {
          errors.push(`Error creating scout ${scout.firstName} ${scout.lastName}: ${scoutError.message}`)
          continue
        }

        scoutId = newScout.id
        scoutsImported++

        // Create scout account
        await adminSupabase
          .from('scout_accounts')
          .insert({
            scout_id: scoutId,
            unit_id: unitId,
            billing_balance: 0,
            funds_balance: 0,
          })
      }

      // Link guardians
      for (const guardian of scout.guardians) {
        let guardianProfileId: string | null = null

        // Try to find guardian by BSA ID first
        if (guardian.bsaMemberId && bsaIdToProfileId.has(guardian.bsaMemberId)) {
          guardianProfileId = bsaIdToProfileId.get(guardian.bsaMemberId)!
        }
        // Then try by email
        else if (guardian.email) {
          const { data: profile } = await adminSupabase
            .from('profiles')
            .select('id')
            .eq('email', guardian.email.toLowerCase())
            .maybeSingle()

          if (profile) {
            guardianProfileId = profile.id
          }
        }

        if (guardianProfileId && scoutId) {
          // Check if guardian link already exists
          const { data: existingLink } = await adminSupabase
            .from('scout_guardians')
            .select('id')
            .eq('scout_id', scoutId)
            .eq('profile_id', guardianProfileId)
            .maybeSingle()

          if (!existingLink) {
            const { error: guardianError } = await adminSupabase
              .from('scout_guardians')
              .insert({
                scout_id: scoutId,
                profile_id: guardianProfileId,
                relationship: guardian.relationship || 'parent',
                is_primary: scout.guardians.indexOf(guardian) === 0,
              })

            if (!guardianError) {
              guardiansLinked++
            }
          }
        }
      }
    } catch (err) {
      errors.push(`Error importing scout ${scout.firstName} ${scout.lastName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    adultsImported,
    adultsUpdated,
    scoutsImported,
    scoutsUpdated,
    guardiansLinked,
    trainingsImported,
    patrolsCreated,
    errors,
  })
}
