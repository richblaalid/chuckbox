import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditScoutButton } from '@/components/scouts/edit-scout-button'
import { ScoutProfileTabs } from '@/components/scouts/scout-profile-tabs'
import { RankIcon } from '@/components/advancement/rank-icon'
import { getScoutAdvancementProgress } from '@/app/actions/advancement'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'

// Rank code to image URL mapping
const RANK_IMAGES: Record<string, string> = {
  scout: '/images/ranks/scout100.png',
  tenderfoot: '/images/ranks/tenderfoot100.png',
  second_class: '/images/ranks/secondclass100.png',
  first_class: '/images/ranks/firstclass100.png',
  star: '/images/ranks/star100.png',
  life: '/images/ranks/life100.png',
  eagle: '/images/ranks/eagle.png',
}

interface ScoutPageProps {
  params: Promise<{ id: string }>
}

export default async function ScoutPage({ params }: ScoutPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Group 1: Parallel fetch of scout details and user profile
  const [scoutResult, profileResult] = await Promise.all([
    supabase
      .from('scouts')
      .select(`
        id,
        first_name,
        last_name,
        patrol_id,
        rank,
        current_position,
        current_position_2,
        is_active,
        date_of_birth,
        bsa_member_id,
        gender,
        date_joined,
        health_form_status,
        health_form_expires,
        swim_classification,
        swim_class_date,
        created_at,
        updated_at,
        unit_id,
        scout_accounts (
          id,
          billing_balance,
          funds_balance
        ),
        units (
          id,
          name,
          unit_number
        ),
        patrols (
          name
        )
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single(),
  ])

  const scoutData = scoutResult.data
  const profileData = profileResult.data

  if (!scoutData) {
    notFound()
  }

  // Get user's unit membership to check role (depends on profile)
  const { data: membershipData } = profileData
    ? await supabase
        .from('unit_memberships')
        .select('unit_id, role')
        .eq('profile_id', profileData.id)
        .eq('status', 'active')
        .single()
    : { data: null }

  const membership = membershipData as { unit_id: string; role: string } | null
  const canEditScout = membership && ['admin', 'treasurer', 'leader'].includes(membership.role)
  const canEditGuardians = membership && ['admin', 'treasurer'].includes(membership.role)

  // Check if current user is a guardian of this scout (for parent submission feature)
  // Parents who are also leaders will have canEditScout=true, but we still set this
  // so non-leader parents can submit requirements for approval
  const { data: guardianCheck } = profileData
    ? await supabase
        .from('scout_guardians')
        .select('id')
        .eq('scout_id', id)
        .eq('profile_id', profileData.id)
        .maybeSingle()
    : { data: null }

  const isParentOfScout = !!guardianCheck

  interface Scout {
    id: string
    first_name: string
    last_name: string
    patrol_id: string | null
    rank: string | null
    current_position: string | null
    current_position_2: string | null
    is_active: boolean | null
    date_of_birth: string | null
    bsa_member_id: string | null
    gender: string | null
    date_joined: string | null
    health_form_status: string | null
    health_form_expires: string | null
    swim_classification: string | null
    swim_class_date: string | null
    created_at: string | null
    updated_at: string | null
    unit_id: string
    scout_accounts: { id: string; billing_balance: number | null; funds_balance: number } | null
    units: { id: string; name: string; unit_number: string } | null
    patrols: { name: string } | null
  }

  const scout = scoutData as Scout

  // Fetch guardians for this scout
  const { data: guardiansData } = await supabase
    .from('scout_guardians')
    .select(`
      id,
      relationship,
      is_primary,
      profile_id,
      profiles (
        id,
        first_name,
        last_name,
        full_name,
        email,
        member_type,
        position,
        user_id
      )
    `)
    .eq('scout_id', id)
    .order('is_primary', { ascending: false })

  interface Guardian {
    id: string
    relationship: string | null
    is_primary: boolean | null
    profile_id: string
    profiles: {
      id: string
      first_name: string | null
      last_name: string | null
      full_name: string | null
      email: string | null
      member_type: string | null
      position: string | null
      user_id: string | null
    }
  }

  const guardians = ((guardiansData || []) as Guardian[]).filter(g => g.profiles !== null)

  // Group 3: Parallel fetch of unit members (for available profiles) and advancement data
  const advancementEnabled = isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)
  type AdvancementData = Awaited<ReturnType<typeof getScoutAdvancementProgress>>

  let availableProfiles: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; member_type: string | null; user_id: string | null }[] = []
  let advancementData: AdvancementData = null

  if (membership) {
    // Run unit members fetch and advancement fetch in parallel
    const [membersResult, advancementResult] = await Promise.all([
      canEditGuardians
        ? supabase
            .from('unit_memberships')
            .select('profile_id')
            .eq('unit_id', membership.unit_id)
            .in('status', ['active', 'roster', 'invited'])
        : Promise.resolve({ data: null }),
      advancementEnabled
        ? getScoutAdvancementProgress(id)
        : Promise.resolve(null),
    ])

    advancementData = advancementResult

    // Group 4: Fetch available profiles if we have member IDs
    if (canEditGuardians && membersResult.data) {
      const profileIds = (membersResult.data || [])
        .map(m => m.profile_id)
        .filter((profileId): profileId is string => profileId !== null)

      if (profileIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, full_name, email, member_type, user_id')
          .in('id', profileIds)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false })

        availableProfiles = (profilesData || []) as typeof availableProfiles
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Rank Badge */}
          {scout.rank && advancementEnabled && (
            <div className="hidden sm:block">
              <RankIcon
                rank={{
                  code: scout.rank.toLowerCase().replace(/\s+/g, '_'),
                  name: scout.rank,
                  image_url: RANK_IMAGES[scout.rank.toLowerCase().replace(/\s+/g, '_')] || null,
                }}
                size="lg"
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/scouts"
                className="text-sm text-stone-500 hover:text-stone-700"
              >
                Scouts
              </Link>
              <span className="text-stone-400">/</span>
              <span className="text-sm text-stone-900">
                {scout.first_name} {scout.last_name}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="text-3xl font-bold text-stone-900">
                {scout.first_name} {scout.last_name}
              </h1>
              {/* Mobile rank badge - smaller, inline */}
              {scout.rank && advancementEnabled && (
                <div className="sm:hidden">
                  <RankIcon
                    rank={{
                      code: scout.rank.toLowerCase().replace(/\s+/g, '_'),
                      name: scout.rank,
                      image_url: RANK_IMAGES[scout.rank.toLowerCase().replace(/\s+/g, '_')] || null,
                    }}
                    size="md"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canEditScout && (
            <EditScoutButton
              unitId={scout.unit_id}
              scout={{
                id: scout.id,
                first_name: scout.first_name,
                last_name: scout.last_name,
                patrol_id: scout.patrol_id,
                rank: scout.rank,
                date_of_birth: scout.date_of_birth,
                bsa_member_id: scout.bsa_member_id,
                is_active: scout.is_active,
              }}
              guardians={canEditGuardians ? guardians.map(g => ({
                id: g.id,
                relationship: g.relationship,
                is_primary: g.is_primary,
                profiles: {
                  id: g.profiles.id,
                  first_name: g.profiles.first_name,
                  last_name: g.profiles.last_name,
                  email: g.profiles.email || '',
                }
              })) : []}
              availableMembers={canEditGuardians ? availableProfiles.map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: p.email || '',
              })) : []}
            />
          )}
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              scout.is_active
                ? 'bg-success-light text-success'
                : 'bg-stone-100 text-stone-600'
            }`}
          >
            {scout.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Tabbed Content */}
      <ScoutProfileTabs
        scout={{
          id: scout.id,
          first_name: scout.first_name,
          last_name: scout.last_name,
          patrol_id: scout.patrol_id,
          rank: scout.rank,
          current_position: scout.current_position,
          current_position_2: scout.current_position_2,
          is_active: scout.is_active,
          date_of_birth: scout.date_of_birth,
          bsa_member_id: scout.bsa_member_id,
          gender: scout.gender,
          date_joined: scout.date_joined,
          health_form_status: scout.health_form_status,
          health_form_expires: scout.health_form_expires,
          swim_classification: scout.swim_classification,
          swim_class_date: scout.swim_class_date,
          unit_id: scout.unit_id,
          scout_accounts: scout.scout_accounts,
          patrols: scout.patrols,
        }}
        guardians={guardians}
        availableProfiles={availableProfiles}
        advancementData={advancementData}
        advancementEnabled={advancementEnabled}
        canEditScout={canEditScout || false}
        canEditGuardians={canEditGuardians || false}
        isParentOfScout={isParentOfScout}
      />
    </div>
  )
}
