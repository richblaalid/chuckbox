'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { CostShareResult } from '@/lib/expenses/cost-sharing'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

/**
 * Get the current user's profile and verify unit access.
 */
async function getUserContext(unitId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, venmo_username')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { error: 'Profile not found' }
  }

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('unit_id', unitId)
    .eq('status', 'active')
    .single()

  if (!membership) {
    return { error: 'Not a member of this unit' }
  }

  return { supabase, user, profile, membership }
}

/**
 * Authenticate the current user and return their profile.
 * Used by actions that don't require unit membership checks.
 */
async function getAuthenticatedProfile() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { error: 'Profile not found' }
  }

  return { supabase, profile }
}

/**
 * Get all active scouts with their guardian info for cost sharing.
 */
export async function getScoutsWithGuardians(
  unitId: string
): Promise<ActionResult> {
  const ctx = await getUserContext(unitId)
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { supabase } = ctx

  const { data: scouts, error } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      scout_guardians (
        profile_id,
        profiles (
          id,
          full_name,
          email,
          venmo_username
        )
      )
    `)
    .eq('unit_id', unitId)
    .eq('is_active', true)
    .order('last_name', { ascending: true })

  if (error) {
    return { success: false, error: error.message }
  }

  interface GuardianJoin {
    profile_id: string
    profiles: {
      id: string
      full_name: string | null
      email: string | null
      venmo_username: string | null
    } | null
  }

  const transformed = (scouts || []).map((scout) => ({
    id: scout.id,
    first_name: scout.first_name,
    last_name: scout.last_name,
    guardians: (scout.scout_guardians as GuardianJoin[] || [])
      .filter((sg) => sg.profiles !== null)
      .map((sg) => ({
        profile_id: sg.profiles!.id,
        full_name: sg.profiles!.full_name,
        email: sg.profiles!.email,
        venmo_username: sg.profiles!.venmo_username,
      })),
  }))

  return { success: true, data: transformed }
}

/**
 * Create cost share records from a cost sharing form submission.
 */
export async function createCostShares(params: {
  unitId: string
  description: string
  totalAmount: number
  result: CostShareResult
}): Promise<ActionResult> {
  const { unitId, description, totalAmount, result } = params

  const ctx = await getUserContext(unitId)
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { supabase, profile } = ctx

  if (result.shares.length === 0) {
    return { success: false, error: 'No shares to create' }
  }

  // Build insert rows
  const rows = result.shares.map((share) => ({
    unit_id: unitId,
    organizer_id: profile.id,
    description,
    total_amount: totalAmount,
    total_scouts: result.totalScouts,
    per_scout_amount: result.perScoutAmount,
    share_amount: share.shareAmount,
    scout_count: share.scoutCount,
    participant_id: share.participantId,
    organizer_venmo: profile.venmo_username,
  }))

  const { error } = await supabase
    .from('expense_cost_shares')
    .insert(rows)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/expenses')
  return { success: true }
}

/**
 * Get cost shares organized by the current user (as organizer).
 */
export async function getOrganizedCostShares(
  unitId: string
): Promise<ActionResult> {
  const ctx = await getUserContext(unitId)
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { supabase, profile } = ctx

  const { data, error } = await supabase
    .from('expense_cost_shares')
    .select(`
      *,
      participant:profiles!expense_cost_shares_participant_id_fkey (
        id, full_name, email, venmo_username
      )
    `)
    .eq('unit_id', unitId)
    .eq('organizer_id', profile.id)
    .order('created_at', { ascending: false })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data }
}

/**
 * Get cost shares where the current user is a participant (owes money).
 */
export async function getParticipantCostShares(
  unitId: string
): Promise<ActionResult> {
  const ctx = await getUserContext(unitId)
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { supabase, profile } = ctx

  const { data, error } = await supabase
    .from('expense_cost_shares')
    .select(`
      *,
      organizer:profiles!expense_cost_shares_organizer_id_fkey (
        id, full_name, email, venmo_username
      )
    `)
    .eq('unit_id', unitId)
    .eq('participant_id', profile.id)
    .order('created_at', { ascending: false })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data }
}

/**
 * Mark a cost share as paid (organizer only).
 */
export async function markCostSharePaid(
  shareId: string
): Promise<ActionResult> {
  const auth = await getAuthenticatedProfile()
  if ('error' in auth) return { success: false, error: auth.error }
  const { supabase, profile } = auth

  const { data: share } = await supabase
    .from('expense_cost_shares')
    .select('id, organizer_id')
    .eq('id', shareId)
    .single()

  if (!share) return { success: false, error: 'Cost share not found' }
  if (share.organizer_id !== profile.id) {
    return { success: false, error: 'Only the organizer can mark shares as paid' }
  }

  const { error } = await supabase
    .from('expense_cost_shares')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .eq('id', shareId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/expenses')
  return { success: true }
}

/**
 * Delete a pending cost share (organizer only).
 */
export async function deleteCostShare(
  shareId: string
): Promise<ActionResult> {
  const auth = await getAuthenticatedProfile()
  if ('error' in auth) return { success: false, error: auth.error }
  const { supabase, profile } = auth

  const { data: share } = await supabase
    .from('expense_cost_shares')
    .select('id, organizer_id, status')
    .eq('id', shareId)
    .single()

  if (!share) return { success: false, error: 'Cost share not found' }
  if (share.organizer_id !== profile.id) {
    return { success: false, error: 'Only the organizer can delete shares' }
  }
  if (share.status !== 'pending') {
    return { success: false, error: 'Can only delete pending shares' }
  }

  const { error } = await supabase
    .from('expense_cost_shares')
    .delete()
    .eq('id', shareId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/expenses')
  return { success: true }
}
