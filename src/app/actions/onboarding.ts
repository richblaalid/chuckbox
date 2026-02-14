'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import {
  parseRosterWithMetadata,
  type ParsedRoster,
  type ParsedAdult,
  type ParsedScout,
  type UnitMetadata,
  getScoutPosition,
} from '@/lib/import/bsa-roster-parser'
import type { Json } from '@/types/database'

// Provisioning tables are now in generated types (migration 20260118000000_unit_provisioning.sql)

// ============================================
// Types
// ============================================

interface ExtractUnitResult {
  success: boolean
  error?: string
  unitMetadata?: UnitMetadata
  roster?: ParsedRoster
  rosterSummary?: {
    adultCount: number
    scoutCount: number
    patrolCount: number
  }
}

interface ProvisionUnitInput {
  unitMetadata: UnitMetadata
  admin: {
    firstName: string
    lastName: string
    email: string
  }
  parsedAdults: ParsedAdult[]
  parsedScouts: ParsedScout[]
  confirmDuplicateOverride?: boolean // If true, proceed despite duplicate warning
}

interface ProvisionResult {
  success: boolean
  error?: string
  unitId?: string
  profileId?: string
  duplicateWarning?: {
    exists: boolean
    existingUnitName: string
  }
}

interface VerifyProvisionResult {
  success: boolean
  error?: string
  unitId?: string
  unitName?: string
  importResult?: {
    adultsImported: number
    scoutsImported: number
    patrolsCreated: number
  }
}

// ============================================
// Rate Limiting
// ============================================

const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_HOURS = 1

async function checkRateLimit(ipAddress: string, email?: string): Promise<{ allowed: boolean; error?: string }> {
  const adminSupabase = createAdminClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000)

  // Check IP-based rate limit
  // Note: signup_rate_limits table will be created by migration 20260118000000_unit_provisioning.sql
  const { data: ipRecord } = await adminSupabase.from('signup_rate_limits')
    .select('*')
    .eq('ip_address', ipAddress)
    .gte('first_attempt_at', windowStart.toISOString())
    .maybeSingle()

  if (ipRecord) {
    if (ipRecord.blocked_until && new Date(ipRecord.blocked_until) > now) {
      return { allowed: false, error: 'Too many signup attempts. Please try again later.' }
    }
    const attempts = ipRecord.attempts ?? 0
    if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      // Block for 1 hour
      await adminSupabase.from('signup_rate_limits')
        .update({
          blocked_until: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
          last_attempt_at: now.toISOString(),
        })
        .eq('id', ipRecord.id)
      return { allowed: false, error: 'Too many signup attempts. Please try again in an hour.' }
    }
    // Increment attempts
    await adminSupabase.from('signup_rate_limits')
      .update({
        attempts: attempts + 1,
        last_attempt_at: now.toISOString(),
        email: email || ipRecord.email,
      })
      .eq('id', ipRecord.id)
  } else {
    // Create new rate limit record
    await adminSupabase.from('signup_rate_limits').insert({
      ip_address: ipAddress,
      email,
      attempts: 1,
      first_attempt_at: now.toISOString(),
      last_attempt_at: now.toISOString(),
    })
  }

  return { allowed: true }
}

// ============================================
// Extract Unit from CSV
// ============================================

export async function extractUnitFromCSV(csvContent: string): Promise<ExtractUnitResult> {
  try {
    // Parse CSV and extract metadata
    const roster = parseRosterWithMetadata(csvContent)

    if (!roster.unitMetadata) {
      return { success: false, error: 'Could not extract unit information from the CSV file' }
    }

    const { unitMetadata } = roster

    if (!unitMetadata.unitType || !unitMetadata.unitNumber) {
      return {
        success: false,
        error: 'Could not determine unit type or number from the CSV. Please ensure this is a valid BSA roster export.',
      }
    }

    // Count unique patrols
    const patrols = new Set(roster.scouts.map(s => s.patrol).filter(Boolean))

    return {
      success: true,
      unitMetadata,
      roster,
      rosterSummary: {
        adultCount: roster.adults.length,
        scoutCount: roster.scouts.length,
        patrolCount: patrols.size,
      },
    }
  } catch (err) {
    console.error('Error extracting unit from CSV:', err)
    return { success: false, error: 'Failed to parse CSV file. Please ensure it is a valid BSA roster export.' }
  }
}

// ============================================
// Check for Duplicate Unit
// ============================================

/**
 * Normalize council name for comparison - lowercase, trim, remove numbers
 */
function normalizeForComparison(council: string | null): string {
  if (!council) return ''
  // Normalize: lowercase, trim, remove trailing numbers, remove duplicate text
  let normalized = council.toLowerCase().trim()

  // Check for duplicated text (the council name repeated twice)
  const halfLength = Math.floor(normalized.length / 2)
  if (halfLength > 0) {
    const firstHalf = normalized.substring(0, halfLength)
    const secondHalf = normalized.substring(halfLength)
    if (firstHalf === secondHalf) {
      normalized = firstHalf
    }
  }

  // Remove trailing numbers
  normalized = normalized.replace(/\s+\d+\s*$/, '').trim()

  return normalized
}

async function checkDuplicateUnit(unitMetadata: UnitMetadata): Promise<{ exists: boolean; unitName?: string }> {
  if (!unitMetadata.unitType || !unitMetadata.unitNumber) {
    return { exists: false }
  }

  const adminSupabase = createAdminClient()

  // Normalize the input council name for comparison
  const normalizedInputCouncil = normalizeForComparison(unitMetadata.council)

  // Fetch units with matching type and number, then filter by normalized council
  const { data: matchingUnits } = await adminSupabase
    .from('units')
    .select('id, name, council')
    .eq('unit_type', unitMetadata.unitType)
    .eq('unit_number', unitMetadata.unitNumber)
    .is('parent_unit_id', null)
    .eq('is_section', false)

  if (!matchingUnits || matchingUnits.length === 0) {
    return { exists: false }
  }

  // Find a unit with matching normalized council name
  const existingUnit = matchingUnits.find(unit => {
    const normalizedStoredCouncil = normalizeForComparison(unit.council)
    return normalizedStoredCouncil === normalizedInputCouncil
  })

  if (existingUnit) {
    return { exists: true, unitName: existingUnit.name }
  }

  return { exists: false }
}

// ============================================
// Provision Unit
// ============================================

export async function provisionUnit(input: ProvisionUnitInput, ipAddress: string): Promise<ProvisionResult> {
  const { unitMetadata, admin, parsedAdults, parsedScouts } = input

  // Check rate limit
  const rateLimitResult = await checkRateLimit(ipAddress, admin.email)
  if (!rateLimitResult.allowed) {
    return { success: false, error: rateLimitResult.error }
  }

  // Validate required fields
  if (!unitMetadata.unitType || !unitMetadata.unitNumber) {
    return { success: false, error: 'Unit type and number are required' }
  }

  if (!admin.firstName || !admin.lastName || !admin.email) {
    return { success: false, error: 'Admin name and email are required' }
  }

  // Check for duplicate unit
  const duplicateCheck = await checkDuplicateUnit(unitMetadata)
  if (duplicateCheck.exists && !input.confirmDuplicateOverride) {
    // Return a warning, not a hard error - allow user to confirm and proceed
    return {
      success: false,
      duplicateWarning: {
        exists: true,
        existingUnitName: duplicateCheck.unitName || 'Unknown',
      },
    }
  }

  const adminSupabase = createAdminClient()

  try {
    // Build unit name (e.g., "Troop 9297" or "Troop 9297B")
    const unitTypeName = unitMetadata.unitType.charAt(0).toUpperCase() + unitMetadata.unitType.slice(1)
    const unitName = unitMetadata.unitSuffix
      ? `${unitTypeName} ${unitMetadata.unitNumber}${unitMetadata.unitSuffix}`
      : `${unitTypeName} ${unitMetadata.unitNumber}`

    // 1. Create unit with pending status
    const { data: unit, error: unitError } = await adminSupabase
      .from('units')
      .insert({
        name: unitName,
        unit_number: unitMetadata.unitNumber,
        unit_type: unitMetadata.unitType,
        council: unitMetadata.council,
        district: unitMetadata.district,
        // Note: provisioning_status column will be added by migration 20260118000000_unit_provisioning.sql
      })
      .select('id')
      .single()

    if (unitError || !unit) {
      console.error('Error creating unit:', unitError)
      return { success: false, error: 'Failed to create unit. Please try again.' }
    }

    // 2. Create profile for admin (without user_id - will be linked after email verification)
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .insert({
        first_name: admin.firstName,
        last_name: admin.lastName,
        full_name: `${admin.firstName} ${admin.lastName}`,
        email: admin.email.toLowerCase(),
        is_active: true,
      })
      .select('id')
      .single()

    if (profileError || !profile) {
      console.error('Error creating profile:', profileError)
      // Cleanup: delete the unit we just created
      await adminSupabase.from('units').delete().eq('id', unit.id)
      return { success: false, error: 'Failed to create admin profile. Please try again.' }
    }

    // 3. Create unit membership with invited status
    const { error: membershipError } = await adminSupabase.from('unit_memberships').insert({
      unit_id: unit.id,
      profile_id: profile.id,
      role: 'admin',
      status: 'invited',
    })

    if (membershipError) {
      console.error('Error creating membership:', membershipError)
      // Cleanup
      await adminSupabase.from('profiles').delete().eq('id', profile.id)
      await adminSupabase.from('units').delete().eq('id', unit.id)
      return { success: false, error: 'Failed to create membership. Please try again.' }
    }

    // 4. Generate provisioning token
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    const { data: provisioningToken, error: tokenError } = await adminSupabase.from('unit_provisioning_tokens')
      .insert({
        unit_id: unit.id,
        profile_id: profile.id,
        token_hash: tokenHash,
        email: admin.email.toLowerCase(),
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()

    if (tokenError || !provisioningToken) {
      console.error('Error creating provisioning token:', tokenError)
      // Cleanup
      await adminSupabase.from('unit_memberships').delete().eq('unit_id', unit.id)
      await adminSupabase.from('profiles').delete().eq('id', profile.id)
      await adminSupabase.from('units').delete().eq('id', unit.id)
      return { success: false, error: 'Failed to create verification token. Please try again.' }
    }

    // 5. Stage the roster data for later import
    const { error: stageError } = await adminSupabase.from('staged_roster_imports').insert({
      provisioning_token_id: provisioningToken.id,
      parsed_adults: parsedAdults as unknown as Json,
      parsed_scouts: parsedScouts as unknown as Json,
      unit_metadata: unitMetadata as unknown as Json,
    })

    if (stageError) {
      console.error('Error staging roster data:', stageError)
      // Don't fail completely - the unit can still be verified, just without roster import
    }

    // 6. Send magic link email with provision_token param
    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/confirm?provision_token=${token}&next=/setup`

    const { error: authError } = await adminSupabase.auth.admin.inviteUserByEmail(admin.email.toLowerCase(), {
      redirectTo: redirectUrl,
    })

    if (authError) {
      console.error('Error sending magic link:', authError)
      // Don't fail completely - the user can try to sign in separately
      // But log this for debugging
    }

    return {
      success: true,
      unitId: unit.id,
      profileId: profile.id,
    }
  } catch (err) {
    console.error('Error provisioning unit:', err)
    return { success: false, error: 'An unexpected error occurred. Please try again.' }
  }
}

// ============================================
// Verify Provisioning Token
// ============================================

export async function verifyProvisioningToken(token: string): Promise<VerifyProvisionResult> {
  const adminSupabase = createAdminClient()

  // Hash the token to look up
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  // Find the provisioning token
  const { data: provisioningToken, error: tokenError } = await adminSupabase.from('unit_provisioning_tokens')
    .select('*, units(id, name), profiles(id)')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError || !provisioningToken) {
    return { success: false, error: 'Invalid verification link. Please request a new one.' }
  }

  // Check if already verified
  if (provisioningToken.verified_at) {
    // Already verified - just return success
    return {
      success: true,
      unitId: provisioningToken.unit_id,
      unitName: (provisioningToken.units as { id: string; name: string })?.name,
    }
  }

  // Check if expired
  if (new Date(provisioningToken.expires_at) < new Date()) {
    return { success: false, error: 'This verification link has expired. Please sign up again.' }
  }

  // Get the current authenticated user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Authentication required. Please sign in first.' }
  }

  // Verify email matches
  if (user.email?.toLowerCase() !== provisioningToken.email.toLowerCase()) {
    return { success: false, error: 'Email mismatch. Please sign in with the email you used during signup.' }
  }

  try {
    // 1. Mark token as verified
    await adminSupabase.from('unit_provisioning_tokens')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', provisioningToken.id)

    // 2. Link profile to user account
    await adminSupabase
      .from('profiles')
      .update({ user_id: user.id })
      .eq('id', provisioningToken.profile_id)

    // 3. Activate unit (provisioning_status column will be added by migration)
    // For now, skip this since the column doesn't exist yet
    // await adminSupabase.from('units').update({ provisioning_status: 'active' }).eq('id', provisioningToken.unit_id)

    // 4. Activate membership
    await adminSupabase
      .from('unit_memberships')
      .update({ status: 'active' })
      .eq('unit_id', provisioningToken.unit_id)
      .eq('profile_id', provisioningToken.profile_id)

    // 5. Import staged roster data
    const { data: stagedData } = await adminSupabase.from('staged_roster_imports')
      .select('*')
      .eq('provisioning_token_id', provisioningToken.id)
      .maybeSingle()

    let importResult = { adultsImported: 0, scoutsImported: 0, patrolsCreated: 0 }

    if (stagedData) {
      importResult = await importRosterData(
        provisioningToken.unit_id,
        stagedData.parsed_adults as unknown as ParsedAdult[],
        stagedData.parsed_scouts as unknown as ParsedScout[]
      )

      // Clean up staged data
      await adminSupabase.from('staged_roster_imports')
        .delete()
        .eq('id', stagedData.id)
    }

    return {
      success: true,
      unitId: provisioningToken.unit_id,
      unitName: (provisioningToken.units as { id: string; name: string })?.name,
      importResult,
    }
  } catch (err) {
    console.error('Error verifying provisioning token:', err)
    return { success: false, error: 'Failed to complete verification. Please try again.' }
  }
}

// ============================================
// Import Roster Data (reusable helper)
// ============================================

async function importRosterData(
  unitId: string,
  adults: ParsedAdult[],
  scouts: ParsedScout[]
): Promise<{ adultsImported: number; scoutsImported: number; patrolsCreated: number }> {
  const adminSupabase = createAdminClient()

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
    // Get existing patrols for this unit
    const { data: existingPatrols } = await adminSupabase
      .from('patrols')
      .select('id, name')
      .eq('unit_id', unitId)

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
        const { data: newPatrol } = await adminSupabase
          .from('patrols')
          .insert({
            unit_id: unitId,
            name: patrolName,
            display_order: maxOrder,
            is_active: true,
          })
          .select('id')
          .single()

        if (newPatrol) {
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
      let memberType: 'LEADER' | 'P 18+' = 'P 18+'
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

          // Update existing profile
          await adminSupabase
            .from('profiles')
            .update({
              first_name: adult.firstName,
              last_name: adult.lastName,
              full_name: fullName,
              email: adult.email?.toLowerCase() || null,
              phone_primary: adult.phone || null,
              address_street: adult.address || null,
              address_city: adult.city || null,
              address_state: adult.state || null,
              address_zip: adult.zip || null,
              member_type: memberType,
              position: primaryPosition,
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', profileId)

          // Ensure unit membership exists
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
        }
      }

      // Create new profile if not found
      if (!profileId && adult.bsaMemberId) {
        const { data: newProfile } = await adminSupabase
          .from('profiles')
          .insert({
            bsa_member_id: adult.bsaMemberId,
            first_name: adult.firstName,
            last_name: adult.lastName,
            full_name: fullName,
            email: adult.email?.toLowerCase() || null,
            phone_primary: adult.phone || null,
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

        if (newProfile) {
          profileId = newProfile.id
          adultsImported++

          // Create unit membership
          await adminSupabase.from('unit_memberships').insert({
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
      console.error(`Error importing adult ${adult.firstName} ${adult.lastName}:`, err)
    }
  }

  // ============================================
  // Import Scouts
  // ============================================
  for (const scout of scouts) {
    try {
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

          // Build update object - only include patrol_id if we have a valid value
          // This prevents overwriting existing patrol data with null from duplicate entries
          const updateData: Record<string, unknown> = {
            first_name: scout.firstName,
            last_name: scout.lastName,
            rank: scout.rank,
            date_of_birth: scout.dateOfBirth,
            current_position: scoutPositions.primary,
            current_position_2: scoutPositions.secondary,
            updated_at: new Date().toISOString(),
          }

          // Only update patrol_id if we have a valid value
          if (patrolId) {
            updateData.patrol_id = patrolId
          }

          await adminSupabase
            .from('scouts')
            .update(updateData)
            .eq('id', scoutId)
        }
      }

      // Create new scout if not found
      if (!scoutId) {
        const scoutPositions = getScoutPosition(scout.positions)
        const patrolId = scout.patrol ? patrolNameToId.get(scout.patrol.toLowerCase()) : null
        const { data: newScout } = await adminSupabase
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

        if (newScout) {
          scoutId = newScout.id
          scoutsImported++

          // Create scout account
          await adminSupabase.from('scout_accounts').insert({
            scout_id: scoutId,
            unit_id: unitId,
            billing_balance: 0,
            funds_balance: 0,
          })
        }
      }

      // Link guardians
      for (const guardian of scout.guardians) {
        let guardianProfileId: string | null = null

        if (guardian.bsaMemberId && bsaIdToProfileId.has(guardian.bsaMemberId)) {
          guardianProfileId = bsaIdToProfileId.get(guardian.bsaMemberId)!
        } else if (guardian.email) {
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
          const { data: existingLink } = await adminSupabase
            .from('scout_guardians')
            .select('id')
            .eq('scout_id', scoutId)
            .eq('profile_id', guardianProfileId)
            .maybeSingle()

          if (!existingLink) {
            await adminSupabase.from('scout_guardians').insert({
              scout_id: scoutId,
              profile_id: guardianProfileId,
              relationship: guardian.relationship || 'parent',
              is_primary: scout.guardians.indexOf(guardian) === 0,
            })
          }
        }
      }
    } catch (err) {
      console.error(`Error importing scout ${scout.firstName} ${scout.lastName}:`, err)
    }
  }

  return { adultsImported, scoutsImported, patrolsCreated }
}

// ============================================
// Complete Setup Wizard
// ============================================

export async function completeSetupWizard(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Get user's profile and active unit
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Get user's admin membership
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id')
    .eq('profile_id', profile.id)
    .eq('role', 'admin')
    .eq('status', 'active')
    .single()

  if (!membership) {
    return { success: false, error: 'No admin membership found' }
  }

  const adminSupabase = createAdminClient()

  // Mark setup as complete
  // Note: setup_completed_at column added by migration 20260118000000_unit_provisioning.sql
  // Using type assertion since column doesn't exist in generated types yet
  const { error } = await adminSupabase
    .from('units')
    .update({ setup_completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', membership.unit_id)

  if (error) {
    console.error('Error completing setup:', error)
    return { success: false, error: 'Failed to complete setup' }
  }

  return { success: true }
}

// ============================================
// Get Setup Status
// ============================================

export async function getSetupStatus(): Promise<{
  needsSetup: boolean
  unitId?: string
  unitName?: string
  rosterSummary?: {
    adultCount: number
    scoutCount: number
  }
}> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { needsSetup: false }
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { needsSetup: false }
  }

  // Get user's admin membership
  // Note: setup_completed_at and provisioning_status columns will be added by migration
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, units:units!unit_memberships_unit_id_fkey(id, name)')
    .eq('profile_id', profile.id)
    .eq('role', 'admin')
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) {
    return { needsSetup: false }
  }

  const unit = membership.units as { id: string; name: string } | null

  if (!unit) {
    return { needsSetup: false }
  }

  // Unit is active but setup not completed - get roster summary
  const adminSupabase = createAdminClient()

  const [{ count: adultCount }, { count: scoutCount }] = await Promise.all([
    adminSupabase
      .from('unit_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('unit_id', unit.id),
    adminSupabase
      .from('scouts')
      .select('*', { count: 'exact', head: true })
      .eq('unit_id', unit.id),
  ])

  return {
    needsSetup: true,
    unitId: unit.id,
    unitName: unit.name,
    rosterSummary: {
      adultCount: adultCount || 0,
      scoutCount: scoutCount || 0,
    },
  }
}
