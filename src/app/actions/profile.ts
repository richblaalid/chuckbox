'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success: boolean
  error?: string
}

type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say'

interface ProfileData {
  first_name?: string | null
  last_name?: string | null
  gender?: Gender | null
  email_secondary?: string | null
  phone_primary?: string | null
  phone_secondary?: string | null
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  venmo_username?: string | null
}

// Get current user's profile
export async function getProfile() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated', profile: null }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error) {
    return { success: false, error: 'Failed to load profile', profile: null }
  }

  return { success: true, profile }
}

// Update profile info (name, address, secondary contact)
export async function updateProfile(data: ProfileData): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // Only include fields that are explicitly provided in data
  if ('first_name' in data) updateData.first_name = data.first_name
  if ('last_name' in data) updateData.last_name = data.last_name
  if ('gender' in data) updateData.gender = data.gender
  if ('email_secondary' in data) updateData.email_secondary = data.email_secondary
  if ('phone_primary' in data) updateData.phone_primary = data.phone_primary
  if ('phone_secondary' in data) updateData.phone_secondary = data.phone_secondary
  if ('address_street' in data) updateData.address_street = data.address_street
  if ('address_city' in data) updateData.address_city = data.address_city
  if ('address_state' in data) updateData.address_state = data.address_state
  if ('address_zip' in data) updateData.address_zip = data.address_zip
  if ('venmo_username' in data) updateData.venmo_username = data.venmo_username

  // Update full_name for backward compatibility if name fields are provided
  if ('first_name' in data || 'last_name' in data) {
    const fullName = data.first_name && data.last_name
      ? `${data.first_name} ${data.last_name}`
      : data.first_name || data.last_name || null
    updateData.full_name = fullName
  }

  const { error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('user_id', user.id)

  if (error) {
    console.error('Profile update error:', error)
    return { success: false, error: 'Failed to update profile' }
  }

  revalidatePath('/settings')
  revalidatePath('/')
  return { success: true }
}

// Initiate email change (triggers Supabase Auth verification)
export async function changeEmail(newEmail: string): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(newEmail)) {
    return { success: false, error: 'Invalid email format' }
  }

  // Check if email is same as current
  if (newEmail.toLowerCase() === user.email?.toLowerCase()) {
    return { success: false, error: 'New email is same as current email' }
  }

  // Use Supabase Auth to change email (this sends a verification email)
  const { error } = await supabase.auth.updateUser({
    email: newEmail,
  })

  if (error) {
    console.error('Email change error:', error)
    return { success: false, error: error.message || 'Failed to initiate email change' }
  }

  return { success: true }
}

// Soft delete account
export async function deactivateAccount(): Promise<ActionResult> {
  const supabase = await createClient()

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

  // Mark profile as inactive
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)

  if (profileError) {
    console.error('Deactivate error:', profileError)
    return { success: false, error: 'Failed to deactivate account' }
  }

  // Also deactivate all unit memberships
  const { error: membershipError } = await supabase
    .from('unit_memberships')
    .update({ status: 'inactive' })
    .eq('profile_id', profile.id)

  if (membershipError) {
    console.error('Membership deactivation error:', membershipError)
    // Don't fail the whole operation for this
  }

  // Sign out the user
  await supabase.auth.signOut()

  return { success: true }
}
