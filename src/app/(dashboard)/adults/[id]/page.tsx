import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/data/cached-queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AccessDenied } from '@/components/ui/access-denied'
import { isAdmin, isTreasurer } from '@/lib/roles'
import { EditAdultButton } from '@/components/roster/edit-adult-button'
import { InviteAdultButton } from '@/components/roster/invite-adult-button'

interface AdultDetailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ unit?: string }>
}

export default async function AdultDetailPage({ params, searchParams }: AdultDetailPageProps) {
  const [{ id }, { unit: requestedUnitId }] = await Promise.all([params, searchParams])
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const currentMembership = await getCurrentMembership(requestedUnitId)
  if (!currentMembership) {
    redirect('/login')
  }

  // Only admins and treasurers can view adult details
  if (!isAdmin(currentMembership.role) && !isTreasurer(currentMembership.role)) {
    return <AccessDenied message="Only administrators and treasurers can view adult details." />
  }

  // Use service client to bypass RLS for admin access to other profiles
  const serviceClient = await createServiceClient()

  // Get the adult profile
  const { data: adult } = await serviceClient
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
      user_id,
      created_at,
      updated_at
    `)
    .eq('id', id)
    .single()

  if (!adult) {
    notFound()
  }

  // Verify this adult belongs to the same unit
  const { data: adultMembership } = await serviceClient
    .from('unit_memberships')
    .select('id, role, status, joined_at')
    .eq('profile_id', id)
    .eq('unit_id', currentMembership.unit_id)
    .maybeSingle()

  // Get scouts linked to this adult as guardian
  const { data: guardianships } = await serviceClient
    .from('scout_guardians')
    .select(`
      id,
      relationship,
      is_primary,
      scouts (
        id,
        first_name,
        last_name,
        is_active,
        patrols (
          name
        )
      )
    `)
    .eq('profile_id', id)

  const linkedScouts = (guardianships || []).map(g => ({
    guardianshipId: g.id,
    relationship: g.relationship,
    is_primary: g.is_primary,
    scout: g.scouts as { id: string; first_name: string; last_name: string; is_active: boolean | null; patrols: { name: string } | null }
  })).filter(g => g.scout !== null)

  const displayName = adult.full_name || `${adult.first_name || ''} ${adult.last_name || ''}`.trim() || adult.email || 'Unknown'
  const hasAppAccount = !!adult.user_id

  const formatMemberType = (type: string | null) => {
    if (!type) return null
    if (type === 'LEADER') return 'Leader'
    if (type === 'P 18+') return 'Parent'
    return type
  }

  const getBsaStatusBadge = (renewalStatus: string | null) => {
    if (!renewalStatus) return null

    const isExpired = renewalStatus.toLowerCase().includes('expired')
    const isCurrent = renewalStatus.toLowerCase().includes('current') ||
                      renewalStatus.toLowerCase().includes('registered')

    return (
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
          isExpired
            ? 'bg-error-light text-error'
            : isCurrent
              ? 'bg-success-light text-success'
              : 'bg-stone-100 text-stone-600'
        }`}
      >
        {renewalStatus}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb and Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/roster"
              className="text-sm text-stone-500 hover:text-stone-700"
            >
              Roster
            </Link>
            <span className="text-stone-400">/</span>
            <span className="text-sm text-stone-900">{displayName}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-stone-900">{displayName}</h1>
        </div>
        <div className="flex items-center gap-3">
          <EditAdultButton
            unitId={currentMembership.unit_id}
            adult={{
              id: adult.id,
              user_id: adult.user_id,
              first_name: adult.first_name,
              last_name: adult.last_name,
              email: adult.email,
              email_secondary: adult.email_secondary,
              phone_home: adult.phone_home,
              phone_mobile: adult.phone_mobile,
              address_street: adult.address_street,
              address_city: adult.address_city,
              address_state: adult.address_state,
              address_zip: adult.address_zip,
              member_type: adult.member_type,
              position: adult.position,
              position_2: adult.position_2,
              bsa_member_id: adult.bsa_member_id,
              is_active: adult.is_active,
            }}
          />
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              adult.is_active !== false
                ? 'bg-success-light text-success'
                : 'bg-stone-100 text-stone-600'
            }`}
          >
            {adult.is_active !== false ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personal Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-stone-500">Email</p>
                <p className="font-medium">{adult.email || '—'}</p>
              </div>
              {adult.email_secondary && (
                <div>
                  <p className="text-sm text-stone-500">Secondary Email</p>
                  <p className="font-medium">{adult.email_secondary}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-stone-500">Home Phone</p>
                <p className="font-medium">{adult.phone_home || '—'}</p>
              </div>
              {adult.phone_mobile && (
                <div>
                  <p className="text-sm text-stone-500">Mobile Phone</p>
                  <p className="font-medium">{adult.phone_mobile}</p>
                </div>
              )}
            </div>
            {(adult.address_street || adult.address_city) && (
              <div>
                <p className="text-sm text-stone-500">Address</p>
                <p className="font-medium">
                  {adult.address_street && <span>{adult.address_street}<br /></span>}
                  {adult.address_city && `${adult.address_city}, `}
                  {adult.address_state} {adult.address_zip}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BSA Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>BSA Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-stone-500">Member Type</p>
                <p className="font-medium">{formatMemberType(adult.member_type) || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-stone-500">BSA Member ID</p>
                <p className="font-medium">{adult.bsa_member_id || '—'}</p>
              </div>
              {adult.position && (
                <div>
                  <p className="text-sm text-stone-500">Position</p>
                  <p className="font-medium">
                    {adult.position}
                    {adult.position_2 && <span className="text-stone-500"><br />{adult.position_2}</span>}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm text-stone-500">Registration Status</p>
                <div className="mt-1">
                  {getBsaStatusBadge(adult.renewal_status) || <span className="font-medium">—</span>}
                </div>
              </div>
              {adult.expiration_date && (
                <div>
                  <p className="text-sm text-stone-500">Expiration Date</p>
                  <p className="font-medium">{adult.expiration_date}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* App Status Card */}
        <Card>
          <CardHeader>
            <CardTitle>App Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-stone-500">Account Status</p>
                <div className="mt-1">
                  {hasAppAccount ? (
                    <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-forest-100 text-forest-700">
                      Has App Account
                    </span>
                  ) : adultMembership?.status === 'invited' ? (
                    <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700">
                      Invite Pending
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-stone-100 text-stone-500">
                      No App Account
                    </span>
                  )}
                </div>
              </div>
              {!hasAppAccount && adultMembership?.status === 'roster' && (
                <InviteAdultButton
                  unitId={currentMembership.unit_id}
                  adult={{
                    id: adult.id,
                    first_name: adult.first_name,
                    last_name: adult.last_name,
                    full_name: adult.full_name,
                    email: adult.email,
                    member_type: adult.member_type,
                    position: adult.position,
                    bsa_member_id: adult.bsa_member_id,
                    user_id: adult.user_id,
                  }}
                />
              )}
            </div>
            {adultMembership && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-stone-500">Unit Role</p>
                  <p className="font-medium capitalize">{adultMembership.role}</p>
                </div>
                <div>
                  <p className="text-sm text-stone-500">Membership Status</p>
                  <p className="font-medium capitalize">{adultMembership.status}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Linked Scouts Card */}
        <Card>
          <CardHeader>
            <CardTitle>Linked Scouts</CardTitle>
          </CardHeader>
          <CardContent>
            {linkedScouts.length > 0 ? (
              <div className="space-y-3">
                {linkedScouts.map((g) => (
                  <Link
                    key={g.guardianshipId}
                    href={`/scouts/${g.scout.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-stone-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-stone-900">
                        {g.scout.first_name} {g.scout.last_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span className="capitalize">{g.relationship || 'Guardian'}</span>
                        {g.is_primary && (
                          <>
                            <span>·</span>
                            <span className="text-amber-600">Primary</span>
                          </>
                        )}
                        {g.scout.patrols?.name && (
                          <>
                            <span>·</span>
                            <span>{g.scout.patrols.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        g.scout.is_active
                          ? 'bg-success-light text-success'
                          : 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {g.scout.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-stone-500">No scouts linked as guardian</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
