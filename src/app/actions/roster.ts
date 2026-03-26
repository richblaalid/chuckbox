'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success: boolean
  error?: string
  warning?: string
  profileId?: string
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
}

interface Guardianship {
  id: string
  scout_id: string
  scout_name: string
  relationship: string | null
  is_primary: boolean | null
}

interface AdultFormDataResult {
  success: boolean
  error?: string
  scouts?: Scout[]
  guardianships?: Guardianship[]
}

// Fetch scouts and guardianships for adult form (edit mode)
export async function getAdultFormData(
  unitId: string,
  profileId: string
): Promise<AdultFormDataResult> {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Get current user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check if user has permission (admin or treasurer)
  const { data: currentMembership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!currentMembership || !['admin', 'treasurer'].includes(currentMembership.role)) {
    return { success: false, error: 'Permission denied' }
  }

  const adminSupabase = createAdminClient()

  // Fetch all scouts in the unit
  const { data: scoutsData } = await adminSupabase
    .from('scouts')
    .select('id, first_name, last_name, is_active')
    .eq('unit_id', unitId)
    .order('last_name', { ascending: true })

  // Fetch guardianships for this adult
  const { data: guardianshipsData } = await adminSupabase
    .from('scout_guardians')
    .select(`
      id,
      relationship,
      is_primary,
      scout_id,
      scouts (
        id,
        first_name,
        last_name
      )
    `)
    .eq('profile_id', profileId)

  const scouts: Scout[] = (scoutsData || []).map(s => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    is_active: s.is_active,
  }))

  const guardianships: Guardianship[] = (guardianshipsData || [])
    .filter(g => g.scouts !== null)
    .map(g => {
      const scout = g.scouts as { id: string; first_name: string; last_name: string }
      return {
        id: g.id,
        scout_id: scout.id,
        scout_name: `${scout.first_name} ${scout.last_name}`,
        relationship: g.relationship,
        is_primary: g.is_primary,
      }
    })

  return { success: true, scouts, guardianships }
}

type MemberRole = 'admin' | 'treasurer' | 'leader' | 'parent'

// Create a new adult profile and add to unit roster
export async function createRosterAdult(
  unitId: string,
  data: {
    first_name: string
    last_name: string
    email: string | null
    phone_home: string | null
    member_type: string | null
    position: string | null
    bsa_member_id: string | null
    sendInvite: boolean
    inviteRole?: MemberRole
  }
): Promise<ActionResult> {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Get current user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check if user is admin of the specified unit
  const { data: currentMembership, error: membershipError } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) {
    console.error('Membership check error:', membershipError)
    return { success: false, error: 'Failed to verify permissions' }
  }

  if (!currentMembership || !['admin', 'treasurer'].includes(currentMembership.role)) {
    return { success: false, error: 'Only admins and treasurers can add adults' }
  }

  // If sending invite, email is required
  if (data.sendInvite && !data.email) {
    return { success: false, error: 'Email is required to send an invite' }
  }

  // If sending invite, check if email already exists
  if (data.sendInvite && data.email) {
    const adminSupabase = createAdminClient()
    const { data: existingProfile } = await adminSupabase
      .from('profiles')
      .select('id')
      .eq('email', data.email.toLowerCase())
      .maybeSingle()

    if (existingProfile) {
      return { success: false, error: 'A profile with this email already exists' }
    }

    // Check for existing invite in unit_memberships
    const { data: existingInvite } = await adminSupabase
      .from('unit_memberships')
      .select('id')
      .eq('unit_id', unitId)
      .eq('email', data.email.toLowerCase())
      .in('status', ['invited', 'active'])
      .maybeSingle()

    if (existingInvite) {
      return { success: false, error: 'A member with this email already exists in this unit' }
    }
  }

  const adminSupabase = createAdminClient()

  // Create the profile
  const { data: newProfile, error: profileError } = await adminSupabase
    .from('profiles')
    .insert({
      first_name: data.first_name,
      last_name: data.last_name,
      full_name: `${data.first_name} ${data.last_name}`,
      email: data.email?.toLowerCase() || null,
      phone_home: data.phone_home,
      member_type: data.member_type,
      position: data.position,
      bsa_member_id: data.bsa_member_id,
      is_active: true,
    })
    .select('id')
    .single()

  if (profileError || !newProfile) {
    console.error('Create profile error:', profileError)
    return { success: false, error: 'Failed to create profile' }
  }

  // Create the unit membership
  const membershipStatus = data.sendInvite ? 'invited' : 'roster'
  const membershipRole = data.sendInvite && data.inviteRole ? data.inviteRole : 'parent'

  const { error: membershipInsertError } = await adminSupabase
    .from('unit_memberships')
    .insert({
      unit_id: unitId,
      profile_id: newProfile.id,
      role: membershipRole,
      status: membershipStatus,
      email: data.email?.toLowerCase() || null,
      invited_by: data.sendInvite ? profile.id : null,
      invited_at: data.sendInvite ? new Date().toISOString() : null,
      joined_at: data.sendInvite ? null : new Date().toISOString(),
    })

  if (membershipInsertError) {
    console.error('Create membership error:', membershipInsertError)
    // Clean up the profile we just created
    await adminSupabase.from('profiles').delete().eq('id', newProfile.id)
    return { success: false, error: 'Failed to add adult to unit' }
  }

  // Send invite email if requested
  if (data.sendInvite && data.email) {
    try {
      const { error: emailError } = await adminSupabase.auth.admin.inviteUserByEmail(
        data.email.toLowerCase(),
        {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
          data: {
            profile_id: newProfile.id,
          },
        }
      )

      if (emailError?.code === 'email_exists') {
        revalidatePath('/roster')
        return {
          success: true,
          profileId: newProfile.id,
          warning: 'Adult added. User already has an account - they can log in to access the unit.',
        }
      } else if (emailError) {
        console.error('Auth email error:', emailError)
        revalidatePath('/roster')
        return {
          success: true,
          profileId: newProfile.id,
          warning: 'Adult added but invite email may not have been sent.',
        }
      }
    } catch (err) {
      console.error('Admin client error:', err)
      revalidatePath('/roster')
      return {
        success: true,
        profileId: newProfile.id,
        warning: 'Adult added but invite email may not have been sent.',
      }
    }
  }

  revalidatePath('/roster')
  return { success: true, profileId: newProfile.id }
}

// Update a roster adult's profile (admin only)
export async function updateRosterAdult(
  unitId: string,
  profileId: string,
  data: {
    first_name: string | null
    last_name: string | null
    email: string | null // Only updated if profile has no user account
    email_secondary: string | null
    phone_home: string | null
    phone_mobile: string | null
    address_street: string | null
    address_city: string | null
    address_state: string | null
    address_zip: string | null
    member_type: string | null
    position: string | null
    position_2: string | null
    bsa_member_id: string | null
    is_active: boolean
  }
): Promise<ActionResult> {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Get current user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check if user is admin of the specified unit
  const { data: currentMembership, error: membershipError } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) {
    console.error('Membership check error:', membershipError)
    return { success: false, error: 'Failed to verify permissions' }
  }

  if (!currentMembership || currentMembership.role !== 'admin') {
    return { success: false, error: 'Only admins can update roster adults' }
  }

  // Use admin client to bypass RLS
  const adminSupabase = createAdminClient()

  // Get the profile first
  const { data: targetProfile, error: profileError } = await adminSupabase
    .from('profiles')
    .select('id, user_id')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError) {
    console.error('Profile lookup error:', profileError)
    return { success: false, error: 'Failed to verify member' }
  }

  if (!targetProfile) {
    return { success: false, error: 'Adult not found' }
  }

  // Verify the profile belongs to this unit via unit_memberships
  const { data: membershipCheck, error: membershipCheckError } = await adminSupabase
    .from('unit_memberships')
    .select('id')
    .eq('profile_id', profileId)
    .eq('unit_id', unitId)
    .maybeSingle()

  if (membershipCheckError) {
    console.error('Membership check error:', membershipCheckError)
    return { success: false, error: 'Failed to verify member' }
  }

  if (!membershipCheck) {
    return { success: false, error: 'Adult not found in your unit' }
  }

  // Build update data - only include email if profile has no user account
  const updateData: Record<string, unknown> = {
    first_name: data.first_name,
    last_name: data.last_name,
    full_name: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
    email_secondary: data.email_secondary,
    phone_home: data.phone_home,
    phone_mobile: data.phone_mobile,
    address_street: data.address_street,
    address_city: data.address_city,
    address_state: data.address_state,
    address_zip: data.address_zip,
    member_type: data.member_type,
    position: data.position,
    position_2: data.position_2,
    bsa_member_id: data.bsa_member_id,
    is_active: data.is_active,
    updated_at: new Date().toISOString(),
  }

  // Only allow email update if profile has no user account (imported profile)
  if (!targetProfile.user_id && data.email !== undefined) {
    updateData.email = data.email?.toLowerCase() || null
  }

  const { error } = await adminSupabase
    .from('profiles')
    .update(updateData)
    .eq('id', profileId)

  if (error) {
    console.error('Update profile error:', error)
    return { success: false, error: 'Failed to update profile' }
  }

  revalidatePath('/roster')
  revalidatePath(`/adults/${profileId}`)
  return { success: true }
}
