/**
 * Scoutbook Import Functions
 *
 * Handles importing extracted Scoutbook data into Chuckbox database.
 * Supports staging for preview-before-import flow.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { RosterMember } from './types'

/**
 * Determine if a member is active based on their BSA renewal status.
 * A member is considered active unless their status explicitly indicates "Expired".
 * - "Current" → active
 * - "Eligible for Renewal" → active (registration expiring soon but still a member)
 * - "Expired" → inactive
 */
function isRenewalStatusActive(renewalStatus: string | null | undefined): boolean {
  if (!renewalStatus) return true // Default to active if no status
  return !renewalStatus.toLowerCase().includes('expired')
}

export interface ImportResult {
  // Scouts
  created: number
  updated: number
  skipped: number
  errors: Array<{ member: RosterMember; error: string }>
  // Adults
  adultsCreated: number
  adultsUpdated: number
  adultsLinked: number
}

export interface StagingResult {
  sessionId: string
  // Scouts
  toCreate: number
  toUpdate: number
  toSkip: number
  total: number
  // Adults
  adultsToCreate: number
  adultsToUpdate: number
  adultsTotal: number
}

export interface StagedMember {
  id: string
  bsaMemberId: string
  fullName: string
  firstName: string
  lastName: string
  memberType: string
  age: string | null
  rank: string | null
  patrol: string | null
  position: string | null
  position2: string | null
  renewalStatus: string | null
  expirationDate: string | null
  changeType: 'create' | 'update' | 'skip'
  existingScoutId: string | null
  changes: Record<string, { old: string | null; new: string | null }> | null
  skipReason: string | null
  isSelected: boolean
  // Adult-specific fields
  existingProfileId: string | null
  matchedProfileId: string | null
  matchType: 'bsa_id' | 'name_exact' | 'name_fuzzy' | 'none' | null
}

/**
 * Parse a full name into first and last name
 * Handles formats like "Smith, John" or "John Smith"
 */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim()

  // Check for "Last, First" format
  if (trimmed.includes(',')) {
    const [lastName, firstName] = trimmed.split(',').map((s) => s.trim())
    return { firstName: firstName || '', lastName: lastName || trimmed }
  }

  // Assume "First Last" format
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' }
  }

  const lastName = parts.pop() || ''
  const firstName = parts.join(' ')
  return { firstName, lastName }
}

/**
 * Stage roster members for preview before import
 *
 * Analyzes each member to determine:
 * - Youth: create (new), update (existing with changes), skip (no changes)
 * - Adults: create (new profile), update (existing profile with changes)
 *           Also matches adults to existing profiles by BSA ID or name
 */
export async function stageRosterMembers(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  unitId: string,
  rosterMembers: RosterMember[]
): Promise<StagingResult> {
  // Get existing scouts by BSA member ID for this unit
  const { data: existingScouts, error: scoutsError } = await supabase
    .from('scouts')
    .select('id, bsa_member_id, first_name, last_name, rank, patrol_id, current_position, current_position_2, renewal_status, expiration_date')
    .eq('unit_id', unitId)
    .not('bsa_member_id', 'is', null)

  if (scoutsError) {
    throw new Error(`Failed to fetch existing scouts: ${scoutsError.message}`)
  }

  // Get existing adult profiles by BSA member ID for this unit
  // Adults are profiles with a unit_membership and member_type set
  const { data: unitMemberProfiles, error: adultsError } = await supabase
    .from('unit_memberships')
    .select(`
      profile_id,
      profiles:profiles!unit_memberships_profile_id_fkey (
        id, bsa_member_id, first_name, last_name, full_name, position, position_2, member_type, renewal_status, expiration_date
      )
    `)
    .eq('unit_id', unitId)
    .in('status', ['active', 'roster', 'invited'])

  if (adultsError) {
    throw new Error(`Failed to fetch existing adult profiles: ${adultsError.message}`)
  }

  // Also get profiles directly by BSA member ID (may not have unit membership yet)
  const { data: profilesByBsa } = await supabase
    .from('profiles')
    .select('id, bsa_member_id, first_name, last_name, full_name, position, position_2, member_type, renewal_status, expiration_date')
    .not('bsa_member_id', 'is', null)

  // Build map of existing adults by BSA member ID
  type ExistingAdult = {
    id: string
    bsa_member_id: string | null
    first_name: string | null
    last_name: string | null
    position: string | null
    position_2: string | null
    member_type: string | null
    renewal_status: string | null
    expiration_date: string | null
  }
  const existingAdults: ExistingAdult[] = []

  // Add from unit memberships
  for (const membership of unitMemberProfiles || []) {
    const profile = membership.profiles as unknown as {
      id: string
      bsa_member_id: string | null
      first_name: string | null
      last_name: string | null
      position: string | null
      position_2: string | null
      member_type: string | null
      renewal_status: string | null
      expiration_date: string | null
    }
    if (profile && profile.member_type && profile.bsa_member_id) {
      existingAdults.push({
        id: profile.id,
        bsa_member_id: profile.bsa_member_id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        position: profile.position,
        position_2: profile.position_2,
        member_type: profile.member_type,
        renewal_status: profile.renewal_status,
        expiration_date: profile.expiration_date,
      })
    }
  }

  // Get profiles with BSA member IDs for matching
  const { data: profilesWithBsaId } = await supabase
    .from('profiles')
    .select('id, bsa_member_id, full_name, first_name, last_name')
    .not('bsa_member_id', 'is', null)

  // Get unit member profile IDs for name matching (any status except inactive)
  const { data: unitMemberships } = await supabase
    .from('unit_memberships')
    .select('profile_id')
    .eq('unit_id', unitId)
    .in('status', ['active', 'roster', 'invited'])
    .not('profile_id', 'is', null)

  const unitProfileIds = (unitMemberships || [])
    .map((um) => um.profile_id)
    .filter((id): id is string => id !== null)

  // Get full profile data for unit members
  const { data: unitProfilesData } = unitProfileIds.length > 0
    ? await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name')
        .in('id', unitProfileIds)
    : { data: [] }

  // Create lookup maps
  const existingScoutsByBsaId = new Map(
    (existingScouts || []).map((s) => [s.bsa_member_id!, s])
  )
  const existingAdultsByBsaId = new Map(
    existingAdults.filter((a) => a.bsa_member_id).map((a) => [a.bsa_member_id!, a])
  )
  const profilesByBsaId = new Map(
    (profilesByBsa || []).filter((p) => p.bsa_member_id).map((p) => [p.bsa_member_id!, p])
  )

  // Helper to match adult to profile
  function matchAdultToProfile(member: RosterMember): {
    profileId: string | null
    matchType: 'bsa_id' | 'name_exact' | 'name_fuzzy' | 'none'
  } {
    // First try BSA ID match
    const bsaMatch = profilesByBsaId.get(member.bsaMemberId)
    if (bsaMatch) {
      return { profileId: bsaMatch.id, matchType: 'bsa_id' }
    }

    // Try exact name match among unit members
    const { firstName, lastName } = parseName(member.name)
    const fullNameLower = member.name.toLowerCase().trim()

    for (const profile of unitProfilesData || []) {
      // Check full name match
      if (profile.full_name?.toLowerCase().trim() === fullNameLower) {
        return { profileId: profile.id, matchType: 'name_exact' }
      }

      // Check first + last name match
      if (
        profile.first_name?.toLowerCase() === firstName.toLowerCase() &&
        profile.last_name?.toLowerCase() === lastName.toLowerCase()
      ) {
        return { profileId: profile.id, matchType: 'name_exact' }
      }
    }

    return { profileId: null, matchType: 'none' }
  }

  const stagedRows: Database['public']['Tables']['sync_staged_members']['Insert'][] = []
  let toCreate = 0
  let toUpdate = 0
  let toSkip = 0
  let adultsToCreate = 0
  let adultsToUpdate = 0

  for (const member of rosterMembers) {
    const { firstName, lastName } = parseName(member.name)

    // Handle adult leaders only (LEADER) - P 18+ are scouts who aged past 18
    if (member.type === 'LEADER') {
      const existingAdult = existingAdultsByBsaId.get(member.bsaMemberId)
      const { profileId, matchType } = matchAdultToProfile(member)

      if (existingAdult) {
        // Check for changes to existing adult profile
        const changes: Record<string, { old: string | null; new: string | null }> = {}

        if (existingAdult.first_name !== firstName) {
          changes.first_name = { old: existingAdult.first_name, new: firstName }
        }
        if (existingAdult.last_name !== lastName) {
          changes.last_name = { old: existingAdult.last_name, new: lastName }
        }
        if (existingAdult.position !== member.position) {
          changes.position = { old: existingAdult.position, new: member.position }
        }
        if (existingAdult.position_2 !== member.position2) {
          changes.position_2 = { old: existingAdult.position_2, new: member.position2 }
        }
        // Check member type (LEADER vs P 18+)
        if (existingAdult.member_type !== member.type) {
          changes.member_type = { old: existingAdult.member_type, new: member.type }
        }
        // Check renewal/registration status (Current, Eligible for Renewal, Expired)
        if (existingAdult.renewal_status !== member.renewalStatus) {
          changes.renewal_status = { old: existingAdult.renewal_status, new: member.renewalStatus }
        }
        // Check expiration date
        if (existingAdult.expiration_date !== member.expirationDate) {
          changes.expiration_date = { old: existingAdult.expiration_date, new: member.expirationDate }
        }

        const hasChanges = Object.keys(changes).length > 0

        stagedRows.push({
          session_id: sessionId,
          unit_id: unitId,
          bsa_member_id: member.bsaMemberId,
          full_name: member.name,
          first_name: firstName,
          last_name: lastName,
          member_type: member.type,
          age: member.age,
          rank: member.lastRankApproved,
          patrol: member.patrol,
          position: member.position,
          position_2: member.position2,
          renewal_status: member.renewalStatus,
          expiration_date: member.expirationDate,
          change_type: hasChanges ? 'update' : 'skip',
          existing_scout_id: null,
          existing_profile_id: existingAdult.id,
          matched_profile_id: existingAdult.id,
          match_type: 'bsa_id',
          changes: hasChanges ? changes : null,
          skip_reason: hasChanges ? null : 'no_changes',
          is_selected: hasChanges, // Auto-select updates
        })

        if (hasChanges) {
          adultsToUpdate++
        } else {
          toSkip++
        }
      } else {
        // New adult - will create profile
        stagedRows.push({
          session_id: sessionId,
          unit_id: unitId,
          bsa_member_id: member.bsaMemberId,
          full_name: member.name,
          first_name: firstName,
          last_name: lastName,
          member_type: member.type,
          age: member.age,
          rank: member.lastRankApproved,
          patrol: member.patrol,
          position: member.position,
          position_2: member.position2,
          renewal_status: member.renewalStatus,
          expiration_date: member.expirationDate,
          change_type: 'create',
          existing_scout_id: null,
          existing_profile_id: null,
          matched_profile_id: profileId,
          match_type: matchType,
          changes: null,
          skip_reason: null,
          is_selected: true, // Auto-select new adults
        })
        adultsToCreate++
      }
      continue
    }

    // Handle youth (YOUTH type)
    const existingScout = existingScoutsByBsaId.get(member.bsaMemberId)

    if (existingScout) {
      // Check for changes
      const changes: Record<string, { old: string | null; new: string | null }> = {}

      if (existingScout.first_name !== firstName) {
        changes.first_name = { old: existingScout.first_name, new: firstName }
      }
      if (existingScout.last_name !== lastName) {
        changes.last_name = { old: existingScout.last_name, new: lastName }
      }
      if (existingScout.rank !== member.lastRankApproved) {
        changes.rank = { old: existingScout.rank, new: member.lastRankApproved }
      }
      // Note: Patrol comparison skipped - will be updated via patrol_id during import
      if (existingScout.current_position !== member.position) {
        changes.position = { old: existingScout.current_position, new: member.position }
      }
      if (existingScout.current_position_2 !== member.position2) {
        changes.position_2 = { old: existingScout.current_position_2, new: member.position2 }
      }
      // Check renewal/registration status (Current, Eligible for Renewal, Expired)
      if (existingScout.renewal_status !== member.renewalStatus) {
        changes.renewal_status = { old: existingScout.renewal_status, new: member.renewalStatus }
      }
      // Check expiration date
      if (existingScout.expiration_date !== member.expirationDate) {
        changes.expiration_date = { old: existingScout.expiration_date, new: member.expirationDate }
      }

      const hasChanges = Object.keys(changes).length > 0

      stagedRows.push({
        session_id: sessionId,
        unit_id: unitId,
        bsa_member_id: member.bsaMemberId,
        full_name: member.name,
        first_name: firstName,
        last_name: lastName,
        member_type: member.type,
        age: member.age,
        rank: member.lastRankApproved,
        patrol: member.patrol,
        position: member.position,
        position_2: member.position2,
        renewal_status: member.renewalStatus,
        expiration_date: member.expirationDate,
        change_type: hasChanges ? 'update' : 'skip',
        existing_scout_id: existingScout.id,
        existing_profile_id: null,
        matched_profile_id: null,
        match_type: null,
        changes: hasChanges ? changes : null,
        skip_reason: hasChanges ? null : 'no_changes',
        is_selected: hasChanges, // Auto-select updates
      })

      if (hasChanges) {
        toUpdate++
      } else {
        toSkip++
      }
    } else {
      // New scout
      stagedRows.push({
        session_id: sessionId,
        unit_id: unitId,
        bsa_member_id: member.bsaMemberId,
        full_name: member.name,
        first_name: firstName,
        last_name: lastName,
        member_type: member.type,
        age: member.age,
        rank: member.lastRankApproved,
        patrol: member.patrol,
        position: member.position,
        position_2: member.position2,
        renewal_status: member.renewalStatus,
        expiration_date: member.expirationDate,
        change_type: 'create',
        existing_scout_id: null,
        existing_profile_id: null,
        matched_profile_id: null,
        match_type: null,
        changes: null,
        skip_reason: null,
        is_selected: true, // Auto-select new scouts
      })
      toCreate++
    }
  }

  // Insert all staged rows
  const { error: insertError } = await supabase
    .from('sync_staged_members')
    .insert(stagedRows)

  if (insertError) {
    throw new Error(`Failed to stage members: ${insertError.message}`)
  }

  // Scouts = YOUTH + P 18+ (scouts who aged past 18), Adults = LEADER only
  const scoutsTotal = rosterMembers.filter((m) => m.type === 'YOUTH' || m.type === 'P 18+').length
  const adultsTotal = rosterMembers.filter((m) => m.type === 'LEADER').length

  return {
    sessionId,
    toCreate,
    toUpdate,
    toSkip,
    total: scoutsTotal,
    adultsToCreate,
    adultsToUpdate,
    adultsTotal,
  }
}

/**
 * Get staged members for preview
 */
export async function getStagedMembers(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<StagedMember[]> {
  const { data, error } = await supabase
    .from('sync_staged_members')
    .select('*')
    .eq('session_id', sessionId)
    .order('member_type', { ascending: true }) // YOUTH first, then LEADER, then P 18+
    .order('change_type', { ascending: true }) // create first, then update, then skip
    .order('full_name', { ascending: true })

  if (error) {
    throw new Error(`Failed to get staged members: ${error.message}`)
  }

  return (data || []).map((row) => ({
    id: row.id,
    bsaMemberId: row.bsa_member_id,
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    memberType: row.member_type,
    age: row.age,
    rank: row.rank,
    patrol: row.patrol,
    position: row.position,
    position2: row.position_2,
    renewalStatus: row.renewal_status,
    expirationDate: row.expiration_date,
    changeType: row.change_type as 'create' | 'update' | 'skip',
    existingScoutId: row.existing_scout_id,
    changes: row.changes as Record<string, { old: string | null; new: string | null }> | null,
    skipReason: row.skip_reason,
    isSelected: row.is_selected ?? true,
    // Adult-specific fields
    existingProfileId: row.existing_profile_id,
    matchedProfileId: row.matched_profile_id,
    matchType: row.match_type as 'bsa_id' | 'name_exact' | 'name_fuzzy' | 'none' | null,
  }))
}

/**
 * Update selection status for staged members
 */
export async function updateStagedSelection(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  selections: Array<{ id: string; isSelected: boolean }>
): Promise<void> {
  for (const { id, isSelected } of selections) {
    const { error } = await supabase
      .from('sync_staged_members')
      .update({ is_selected: isSelected })
      .eq('id', id)
      .eq('session_id', sessionId)

    if (error) {
      throw new Error(`Failed to update selection: ${error.message}`)
    }
  }
}

/**
 * Confirm and import selected staged members
 * Handles both scouts (→ scouts table) and adults (→ profiles table)
 */
export async function confirmStagedImport(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  unitId: string
): Promise<ImportResult> {
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    adultsCreated: 0,
    adultsUpdated: 0,
    adultsLinked: 0,
  }

  // Get selected staged members
  const { data: stagedMembers, error: fetchError } = await supabase
    .from('sync_staged_members')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_selected', true)

  if (fetchError) {
    throw new Error(`Failed to fetch staged members: ${fetchError.message}`)
  }

  if (!stagedMembers || stagedMembers.length === 0) {
    return result
  }

  // Separate scouts (YOUTH + P 18+) and adult leaders (LEADER only)
  const scoutMembers = stagedMembers.filter((m) => m.member_type === 'YOUTH' || m.member_type === 'P 18+')
  const adultMembers = stagedMembers.filter((m) => m.member_type === 'LEADER')

  // Get or create patrols for scouts
  const patrolNames = scoutMembers
    .map((m) => m.patrol)
    .filter((p): p is string => !!p && p !== 'unassigned')
  const patrolMap = await getOrCreatePatrols(supabase, unitId, patrolNames)

  // Process scouts
  for (const member of scoutMembers) {
    const patrolId = member.patrol && member.patrol !== 'unassigned'
      ? patrolMap.get(member.patrol) || null
      : null

    if (member.change_type === 'create') {
      const { error: insertError } = await supabase.from('scouts').insert({
        unit_id: unitId,
        bsa_member_id: member.bsa_member_id,
        first_name: member.first_name,
        last_name: member.last_name,
        rank: member.rank,
        patrol_id: patrolId,
        current_position: member.position,
        current_position_2: member.position_2,
        renewal_status: member.renewal_status,
        expiration_date: member.expiration_date,
        is_active: isRenewalStatusActive(member.renewal_status),
      })

      if (insertError) {
        result.errors.push({
          member: {
            name: member.full_name,
            bsaMemberId: member.bsa_member_id,
            type: 'YOUTH',
            age: member.age || '',
            lastRankApproved: member.rank,
            patrol: member.patrol,
            position: member.position,
            position2: member.position_2,
            renewalStatus: member.renewal_status || '',
            expirationDate: member.expiration_date || '',
          },
          error: insertError.message,
        })
      } else {
        result.created++
      }
    } else if (member.change_type === 'update' && member.existing_scout_id) {
      const { error: updateError } = await supabase
        .from('scouts')
        .update({
          first_name: member.first_name,
          last_name: member.last_name,
          rank: member.rank,
          patrol_id: patrolId,
          current_position: member.position,
          current_position_2: member.position_2,
          renewal_status: member.renewal_status,
          expiration_date: member.expiration_date,
          is_active: isRenewalStatusActive(member.renewal_status),
          updated_at: new Date().toISOString(),
        })
        .eq('id', member.existing_scout_id)

      if (updateError) {
        result.errors.push({
          member: {
            name: member.full_name,
            bsaMemberId: member.bsa_member_id,
            type: 'YOUTH',
            age: member.age || '',
            lastRankApproved: member.rank,
            patrol: member.patrol,
            position: member.position,
            position2: member.position_2,
            renewalStatus: member.renewal_status || '',
            expirationDate: member.expiration_date || '',
          },
          error: updateError.message,
        })
      } else {
        result.updated++
      }
    }
  }

  // Process adults → profiles table
  for (const member of adultMembers) {
    if (member.change_type === 'create') {
      // Create new profile for adult (or update existing matched profile)
      if (member.matched_profile_id) {
        // Update the matched profile with BSA data
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            bsa_member_id: member.bsa_member_id,
            first_name: member.first_name,
            last_name: member.last_name,
            full_name: member.full_name,
            member_type: member.member_type as 'LEADER' | 'P 18+',
            position: member.position,
            position_2: member.position_2,
            renewal_status: member.renewal_status,
            expiration_date: member.expiration_date,
            is_active: isRenewalStatusActive(member.renewal_status),
            last_synced_at: new Date().toISOString(),
            sync_session_id: sessionId,
          })
          .eq('id', member.matched_profile_id)

        if (updateError) {
          result.errors.push({
            member: {
              name: member.full_name,
              bsaMemberId: member.bsa_member_id,
              type: member.member_type as 'LEADER' | 'P 18+',
              age: member.age || '',
              lastRankApproved: member.rank,
              patrol: member.patrol,
              position: member.position,
              position2: member.position_2,
              renewalStatus: member.renewal_status || '',
              expirationDate: member.expiration_date || '',
            },
            error: updateError.message,
          })
        } else {
          result.adultsLinked++

          // Ensure unit membership exists for matched profile
          const { data: existingMembership } = await supabase
            .from('unit_memberships')
            .select('id')
            .eq('profile_id', member.matched_profile_id)
            .eq('unit_id', unitId)
            .maybeSingle()

          if (!existingMembership) {
            await supabase.from('unit_memberships').insert({
              unit_id: unitId,
              profile_id: member.matched_profile_id,
              role: member.member_type === 'LEADER' ? 'leader' : 'parent',
              status: 'roster', // Adults from roster are not yet app members
            })
          }
        }
      } else {
        // Create new profile for adult (no matched existing profile)
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            bsa_member_id: member.bsa_member_id,
            first_name: member.first_name,
            last_name: member.last_name,
            full_name: member.full_name,
            member_type: member.member_type as 'LEADER' | 'P 18+',
            position: member.position,
            position_2: member.position_2,
            renewal_status: member.renewal_status,
            expiration_date: member.expiration_date,
            is_active: isRenewalStatusActive(member.renewal_status),
            sync_session_id: sessionId,
            last_synced_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (insertError) {
          result.errors.push({
            member: {
              name: member.full_name,
              bsaMemberId: member.bsa_member_id,
              type: member.member_type as 'LEADER' | 'P 18+',
              age: member.age || '',
              lastRankApproved: member.rank,
              patrol: member.patrol,
              position: member.position,
              position2: member.position_2,
              renewalStatus: member.renewal_status || '',
              expirationDate: member.expiration_date || '',
            },
            error: insertError.message,
          })
        } else {
          result.adultsCreated++

          // Create unit membership for the new profile
          if (newProfile) {
            await supabase.from('unit_memberships').insert({
              unit_id: unitId,
              profile_id: newProfile.id,
              role: member.member_type === 'LEADER' ? 'leader' : 'parent',
              status: 'roster', // Adults from roster are not yet app members
            })
          }
        }
      }
    } else if (member.change_type === 'update' && member.existing_profile_id) {
      // Update existing adult profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          first_name: member.first_name,
          last_name: member.last_name,
          full_name: member.full_name,
          position: member.position,
          position_2: member.position_2,
          renewal_status: member.renewal_status,
          expiration_date: member.expiration_date,
          is_active: isRenewalStatusActive(member.renewal_status),
          last_synced_at: new Date().toISOString(),
          sync_session_id: sessionId,
        })
        .eq('id', member.existing_profile_id)

      if (updateError) {
        result.errors.push({
          member: {
            name: member.full_name,
            bsaMemberId: member.bsa_member_id,
            type: member.member_type as 'LEADER' | 'P 18+',
            age: member.age || '',
            lastRankApproved: member.rank,
            patrol: member.patrol,
            position: member.position,
            position2: member.position_2,
            renewalStatus: member.renewal_status || '',
            expirationDate: member.expiration_date || '',
          },
          error: updateError.message,
        })
      } else {
        result.adultsUpdated++
      }
    }
  }

  // Count skipped (not selected)
  const { count: skippedCount } = await supabase
    .from('sync_staged_members')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('is_selected', false)

  result.skipped = skippedCount || 0

  // Clean up staging table
  await supabase
    .from('sync_staged_members')
    .delete()
    .eq('session_id', sessionId)

  return result
}

/**
 * Cancel staging and clean up
 */
export async function cancelStaging(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<void> {
  await supabase
    .from('sync_staged_members')
    .delete()
    .eq('session_id', sessionId)

  await supabase
    .from('sync_sessions')
    .update({ status: 'cancelled' })
    .eq('id', sessionId)
}

/**
 * Import roster members into the scouts table
 *
 * - Creates new scouts if BSA member ID doesn't exist
 * - Updates existing scouts with current data from Scoutbook
 * - Only imports YOUTH members (adults are skipped)
 *
 * @deprecated Use stageRosterMembers + confirmStagedImport for preview flow
 */
export async function importRosterMembers(
  supabase: SupabaseClient<Database>,
  unitId: string,
  rosterMembers: RosterMember[]
): Promise<ImportResult> {
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    adultsCreated: 0,
    adultsUpdated: 0,
    adultsLinked: 0,
  }

  // Filter to scouts (YOUTH + P 18+), skip adult leaders (LEADER only)
  const scoutMembers = rosterMembers.filter((m) => m.type === 'YOUTH' || m.type === 'P 18+')
  const leaderCount = rosterMembers.filter((m) => m.type === 'LEADER').length

  // Get existing scouts by BSA member ID for this unit
  const { data: existingScouts, error: fetchError } = await supabase
    .from('scouts')
    .select('id, bsa_member_id, first_name, last_name')
    .eq('unit_id', unitId)
    .not('bsa_member_id', 'is', null)

  if (fetchError) {
    console.error('[Import] Failed to fetch existing scouts:', fetchError)
    throw new Error(`Failed to fetch existing scouts: ${fetchError.message}`)
  }

  // Create lookup map by BSA member ID
  const existingByBsaId = new Map(
    (existingScouts || []).map((s) => [s.bsa_member_id!, s])
  )

  // Get or create patrols for this unit
  const patrolMap = await getOrCreatePatrols(
    supabase,
    unitId,
    scoutMembers.map((m) => m.patrol).filter((p): p is string => !!p && p !== 'unassigned')
  )

  // Process each youth member
  for (const member of scoutMembers) {
    try {
      const { firstName, lastName } = parseName(member.name)
      const existing = existingByBsaId.get(member.bsaMemberId)
      const patrolId = member.patrol && member.patrol !== 'unassigned'
        ? patrolMap.get(member.patrol) || null
        : null

      if (existing) {
        // Update existing scout
        const { error: updateError } = await supabase
          .from('scouts')
          .update({
            first_name: firstName,
            last_name: lastName,
            rank: member.lastRankApproved,
            patrol_id: patrolId,
            current_position: member.position,
            is_active: isRenewalStatusActive(member.renewalStatus),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        if (updateError) {
          result.errors.push({ member, error: updateError.message })
        } else {
          result.updated++
        }
      } else {
        // Create new scout
        const { error: insertError } = await supabase.from('scouts').insert({
          unit_id: unitId,
          bsa_member_id: member.bsaMemberId,
          first_name: firstName,
          last_name: lastName,
          rank: member.lastRankApproved,
          patrol_id: patrolId,
          current_position: member.position,
          is_active: isRenewalStatusActive(member.renewalStatus),
        })

        if (insertError) {
          result.errors.push({ member, error: insertError.message })
        } else {
          result.created++
        }
      }
    } catch (err) {
      result.errors.push({
        member,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  result.skipped = leaderCount

  return result
}

/**
 * Get or create patrols for the unit
 * Returns a map of patrol name -> patrol ID
 */
async function getOrCreatePatrols(
  supabase: SupabaseClient<Database>,
  unitId: string,
  patrolNames: string[]
): Promise<Map<string, string>> {
  const uniqueNames = Array.from(new Set(patrolNames))
  const patrolMap = new Map<string, string>()

  if (uniqueNames.length === 0) {
    return patrolMap
  }

  // Get existing patrols
  const { data: existingPatrols } = await supabase
    .from('patrols')
    .select('id, name')
    .eq('unit_id', unitId)

  // Build map of existing patrols
  for (const patrol of existingPatrols || []) {
    patrolMap.set(patrol.name, patrol.id)
  }

  // Create any missing patrols
  for (const name of uniqueNames) {
    if (!patrolMap.has(name)) {
      const { data: newPatrol, error } = await supabase
        .from('patrols')
        .insert({ unit_id: unitId, name })
        .select('id')
        .single()

      if (!error && newPatrol) {
        patrolMap.set(name, newPatrol.id)
      }
    }
  }

  return patrolMap
}
