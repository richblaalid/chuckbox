import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AccessDenied } from '@/components/ui/access-denied'
import { canAccessPage, canPerformAction, hasFilteredView } from '@/lib/roles'
import { RosterTabs } from '@/components/roster/roster-tabs'
import Link from 'next/link'
import { Receipt } from 'lucide-react'

export default async function RosterPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Get user's profile
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  // Get user's unit membership
  const { data: membershipData } = profileData
    ? await supabase
        .from('unit_memberships')
        .select('unit_id, role')
        .eq('profile_id', profileData.id)
        .eq('status', 'active')
        .single()
    : { data: null }

  const membership = membershipData as { unit_id: string; role: string } | null

  if (!membership) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">No Unit Access</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-300">
          You are not currently a member of any unit.
        </p>
      </div>
    )
  }

  // Check role-based access (using 'scouts' permission since roster includes scouts)
  if (!canAccessPage(membership.role, 'scouts')) {
    return <AccessDenied message="You don't have permission to view the roster." />
  }

  interface ScoutWithAccount {
    id: string
    first_name: string
    last_name: string
    patrol_id: string | null
    rank: string | null
    is_active: boolean | null
    date_of_birth: string | null
    bsa_member_id: string | null
    current_position: string | null
    current_position_2: string | null
    scout_accounts: { id: string; billing_balance: number | null } | null
    patrols: { name: string } | null
  }

  interface RosterAdult {
    id: string
    first_name: string | null
    last_name: string | null
    full_name: string | null
    email: string | null
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
    renewal_status: string | null
    expiration_date: string | null
    is_active: boolean | null
    user_id: string | null  // indicates if they have an app account
  }

  const canManageScouts = canPerformAction(membership.role, 'manage_scouts')
  const canManageAdults = ['admin', 'treasurer'].includes(membership.role)
  const isParent = membership.role === 'parent'

  let scouts: ScoutWithAccount[] = []
  let adults: RosterAdult[] = []

  if (isParent && profileData) {
    // Parents only see scouts they are guardians of
    const { data: guardianData } = await supabase
      .from('scout_guardians')
      .select('scout_id')
      .eq('profile_id', profileData.id)

    const scoutIds = (guardianData || []).map(g => g.scout_id)

    if (scoutIds.length > 0) {
      const { data: scoutsData } = await supabase
        .from('scouts')
        .select(`
          id,
          first_name,
          last_name,
          patrol_id,
          rank,
          is_active,
          date_of_birth,
          bsa_member_id,
          current_position,
          current_position_2,
          scout_accounts (
            id,
            billing_balance
          ),
          patrols (name)
        `)
        .in('id', scoutIds)
        .eq('unit_id', membership.unit_id)
        .order('last_name', { ascending: true })

      scouts = (scoutsData as ScoutWithAccount[]) || []
    }
    // Parents don't see adults roster
  } else {
    // Admin, treasurer, leader see all scouts
    const { data: scoutsData } = await supabase
      .from('scouts')
      .select(`
        id,
        first_name,
        last_name,
        patrol_id,
        rank,
        is_active,
        date_of_birth,
        bsa_member_id,
        current_position,
        current_position_2,
        scout_accounts (
          id,
          billing_balance
        ),
        patrols (name)
      `)
      .eq('unit_id', membership.unit_id)
      .order('last_name', { ascending: true })

    scouts = (scoutsData as ScoutWithAccount[]) || []

    // Fetch adult profiles (those with member_type set - from roster import)
    // Get profile IDs from unit memberships (include both 'active' and 'roster' status)
    const { data: memberProfileData } = await supabase
      .from('unit_memberships')
      .select('profile_id')
      .eq('unit_id', membership.unit_id)
      .in('status', ['active', 'roster', 'invited'])

    const memberProfileIds = (memberProfileData || [])
      .map(m => m.profile_id)
      .filter((id): id is string => id !== null)

    if (memberProfileIds.length > 0) {
      const { data: adultsData } = await supabase
        .from('profiles')
        .select(`
          id,
          first_name,
          last_name,
          full_name,
          email,
          email_secondary,
          phone_home,
          phone_mobile,
          address_street,
          address_city,
          address_state,
          address_zip,
          member_type,
          position,
          position_2,
          bsa_member_id,
          renewal_status,
          expiration_date,
          is_active,
          user_id
        `)
        .in('id', memberProfileIds)
        .not('member_type', 'is', null)  // Only adults with member_type (from roster)
        .order('last_name', { ascending: true })

      adults = (adultsData as RosterAdult[]) || []
    }
  }

  const totalMembers = scouts.length + adults.length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-100">Roster</h1>
          <p className="mt-1 text-stone-600 dark:text-stone-300">
            {isParent ? 'Your linked scouts' : 'Manage your unit\'s roster'}
          </p>
        </div>
        {hasFilteredView(membership.role) && (
          <Button asChild variant="outline" className="gap-2">
            <Link href="/expenses/new">
              <Receipt className="h-4 w-4" />
              Submit Expense
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unit Roster</CardTitle>
          <CardDescription>
            {isParent
              ? `${scouts.length} scout${scouts.length !== 1 ? 's' : ''} linked to your account`
              : `${totalMembers} member${totalMembers !== 1 ? 's' : ''} in your unit`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isParent ? (
            // Parents see scouts list only, no tabs
            <div className="space-y-4">
              {scouts.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-stone-500 dark:text-stone-400">No scouts linked to your account.</p>
                </div>
              ) : (
                <RosterTabs
                  scouts={scouts}
                  adults={[]}
                  canManageScouts={canManageScouts}
                  canManageAdults={false}
                  unitId={membership.unit_id}
                />
              )}
            </div>
          ) : (
            <RosterTabs
              scouts={scouts}
              adults={adults}
              canManageScouts={canManageScouts}
              canManageAdults={canManageAdults}
              unitId={membership.unit_id}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
