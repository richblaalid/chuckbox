import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnitInfoForm } from '@/components/settings/unit-info-form'
import { PatrolList } from '@/components/settings/patrol-list'
import { LogoUpload } from '@/components/settings/logo-upload'
import { PaymentProcessingCard } from '@/components/settings/payment-processing-card'
import { ScoutbookSyncCardLazy } from '@/components/settings/scoutbook-sync-card-lazy'
import { BalanceImportCard } from '@/components/settings/balance-import-card'
import { BillingChargeImportCard } from '@/components/settings/billing-charge-import-card'
import { CollectionSettingsCard } from '@/components/settings/collection-settings-card'
import { UsersList } from '@/components/settings/users/users-list'
import { InviteUserButton } from '@/components/settings/users/invite-user-button'
import { BankConnectionCard } from '@/components/plaid/bank-connection-card'
import { resendInvite, removeUser } from '@/app/actions/users'
import { isFinancialRole, isAdmin as checkIsAdmin } from '@/lib/roles'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; tab?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  // Get user's membership and unit info with fee settings
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select(
      `unit_id, role, units:units!unit_memberships_unit_id_fkey(
        id,
        name,
        unit_number,
        unit_type,
        council,
        district,
        chartered_org,
        logo_url,
        processing_fee_percent,
        processing_fee_fixed,
        pass_fees_to_payer,
        collection_settings
      )`
    )
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership) {
    redirect('/login')
  }

  // Only admin and treasurer can access settings
  if (!isFinancialRole(membership.role)) {
    redirect('/profile')
  }

  const isAdmin = checkIsAdmin(membership.role)
  const unit = membership.units as {
    id: string
    name: string
    unit_number: string
    unit_type: string
    council: string | null
    district: string | null
    chartered_org: string | null
    logo_url: string | null
    processing_fee_percent: number | null
    processing_fee_fixed: number | null
    pass_fees_to_payer: boolean | null
    collection_settings: {
      overdue_threshold_days: number
      overdue_threshold_amount_cents: number
      reminder_email_subject: string
      reminder_email_template: string
    } | null
  } | null

  if (!unit) {
    redirect('/profile')
  }

  // Get patrols for this unit (for admin Unit tab)
  const { data: patrols } = await supabase
    .from('patrols')
    .select('id, name, display_order, is_active, unit_id')
    .eq('unit_id', membership.unit_id)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  // Get all users for this unit (both active and invited) - for Users tab
  const { data: usersData } = await supabase
    .from('unit_memberships')
    .select(`
      id,
      role,
      status,
      email,
      joined_at,
      invited_at,
      profiles!unit_memberships_profile_id_fkey (
        id,
        email,
        full_name
      ),
      invited_by_profile:profiles!unit_memberships_invited_by_fkey (
        full_name
      )
    `)
    .eq('unit_id', membership.unit_id)
    .in('status', ['active', 'invited'])
    .order('status', { ascending: true })
    .order('joined_at', { ascending: true, nullsFirst: false })

  interface User {
    id: string
    role: string
    status: string
    email: string | null
    joined_at: string | null
    invited_at: string | null
    profiles: {
      id: string
      email: string
      full_name: string | null
    } | null
    invited_by_profile: {
      full_name: string | null
    } | null
  }

  const allUsers = (usersData as unknown as User[]) || []
  const activeUsers = allUsers.filter(u => u.status === 'active')
  const pendingInvites = allUsers.filter(u => u.status === 'invited')

  // Get all active scouts for this unit (for invite form)
  const { data: scoutsData } = await supabase
    .from('scouts')
    .select('id, first_name, last_name')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name', { ascending: true })

  interface Scout {
    id: string
    first_name: string
    last_name: string
  }
  const scouts = (scoutsData as Scout[]) || []

  // Get Square credentials for this unit
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('*')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()

  // Calculate effective rate from recent transactions (last 30 days)
  let effectiveRate: number | null = null
  if (squareCredentials) {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: recentTransactions } = await supabase
      .from('square_transactions')
      .select('amount_money, fee_money')
      .eq('unit_id', membership.unit_id)
      .eq('status', 'COMPLETED')
      .gte('square_created_at', thirtyDaysAgo.toISOString())

    if (recentTransactions && recentTransactions.length > 0) {
      const totalAmount = recentTransactions.reduce(
        (sum, t) => sum + (t.amount_money || 0),
        0
      )
      const totalFees = recentTransactions.reduce(
        (sum, t) => sum + (t.fee_money || 0),
        0
      )
      if (totalAmount > 0) {
        effectiveRate = totalFees / totalAmount
      }
    }
  }

  // Get Plaid connection for this unit (only if bank integration is enabled)
  const bankIntegrationEnabled = isFeatureEnabled(FeatureFlag.BANK_INTEGRATION)
  const { data: plaidConnection } = bankIntegrationEnabled
    ? await supabase
        .from('plaid_connections')
        .select('id, institution_name, accounts, status, error_message, last_synced_at')
        .eq('unit_id', membership.unit_id)
        .eq('status', 'active')
        .maybeSingle()
    : { data: null }

  interface PlaidAccount {
    account_id: string
    name: string
    mask: string | null
    type: string
    subtype: string | null
    balance?: {
      available: number | null
      current: number | null
      limit: number | null
      currency: string
    }
  }

  interface PlaidConnectionData {
    id: string
    institution_name: string
    accounts: PlaidAccount[]
    status: 'active' | 'error' | 'disconnected'
    error_message: string | null
    last_synced_at: string | null
  }

  const bankConnection = plaidConnection as PlaidConnectionData | null

  // Get last Scoutbook sync session
  const { data: lastSyncSession } = await supabase
    .from('sync_sessions')
    .select('completed_at, records_extracted')
    .eq('unit_id', membership.unit_id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  // Get balance import batches for this unit (most recent 10)
  const { data: importBatchesData } = await supabase
    .from('balance_import_batches')
    .select(`
      id,
      created_at,
      mode,
      row_count,
      status,
      imported_by_profile:profiles!balance_import_batches_imported_by_fkey(
        full_name,
        email
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
    .limit(10)

  interface ImportBatch {
    id: string
    created_at: string
    mode: 'set' | 'adjust'
    row_count: number
    status: 'active' | 'reversed'
    imported_by_profile: {
      full_name: string | null
      email: string | null
    } | null
  }
  const importBatches = (importBatchesData as unknown as ImportBatch[]) || []

  // Check if the latest active batch can be undone
  // It can be undone if there are no journal entries after it was created
  let canUndoLatestBatch = false
  const latestActiveBatch = importBatches.find((b) => b.status === 'active')
  if (latestActiveBatch) {
    const { count: subsequentEntries } = await supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', membership.unit_id)
      .gt('created_at', latestActiveBatch.created_at)
      .is('balance_import_batch_id', null) // Exclude entries from the same batch

    canUndoLatestBatch = (subsequentEntries ?? 0) === 0
  }

  // Get billing charge import batches for this unit (most recent 10)
  const { data: billingBatchesData } = await supabase
    .from('billing_import_batches')
    .select(`
      id,
      created_at,
      total_records,
      total_amount,
      notifications_sent,
      created_by_profile:profiles!billing_import_batches_created_by_fkey(
        full_name,
        email
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
    .limit(10)

  interface BillingBatch {
    id: string
    created_at: string
    total_records: number
    total_amount: number
    notifications_sent: boolean | null
    created_by_profile: {
      full_name: string | null
      email: string | null
    } | null
  }
  const billingBatches = (billingBatchesData as unknown as BillingBatch[]) || []

  // Unit Tab Content (admin only)
  const unitTabContent = isAdmin ? (
    <div className="grid gap-6">
      <UnitInfoForm
        unitId={unit.id}
        name={unit.name}
        unitNumber={unit.unit_number}
        unitType={unit.unit_type}
        council={unit.council}
        district={unit.district}
        charteredOrg={unit.chartered_org}
      />

      <PatrolList
        unitId={membership.unit_id}
        patrols={patrols || []}
      />

      <LogoUpload
        unitId={membership.unit_id}
        currentLogoUrl={unit.logo_url}
      />
    </div>
  ) : null

  // Users Tab Content (admin only)
  const usersTabContent = isAdmin ? (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Unit Users</h2>
          <p className="text-sm text-stone-600">
            Manage who has access to {unit.name}
          </p>
        </div>
        <InviteUserButton unitId={membership.unit_id} scouts={scouts} />
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invites</CardTitle>
            <CardDescription>
              {pendingInvites.length} pending invitation{pendingInvites.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium text-stone-900">{invite.email}</p>
                    <p className="text-sm text-stone-500">
                      Role: <span className="capitalize">{invite.role}</span>
                      {invite.invited_at && (
                        <>
                          {' • '}
                          Invited: {new Date(invite.invited_at).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={async () => {
                      'use server'
                      await resendInvite(invite.id)
                    }}>
                      <button
                        type="submit"
                        className="text-sm text-forest-600 hover:text-forest-800"
                      >
                        Resend
                      </button>
                    </form>
                    <form action={async () => {
                      'use server'
                      await removeUser(membership.unit_id, invite.id)
                    }}>
                      <button
                        type="submit"
                        className="text-sm text-error hover:text-error/80"
                      >
                        Cancel
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Users */}
      <Card>
        <CardHeader>
          <CardTitle>Active Users</CardTitle>
          <CardDescription>
            {activeUsers.length} active user{activeUsers.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersList
            users={activeUsers}
            isAdmin={isAdmin}
            currentUserId={user.id}
            unitId={membership.unit_id}
          />
        </CardContent>
      </Card>

      {/* Role Descriptions */}
      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none text-stone-600">
          <ul className="list-disc pl-4 space-y-2">
            <li><strong>Admin</strong> – Full access: manage users, billing, payments, scouts, and settings</li>
            <li><strong>Treasurer</strong> – Financial access: manage billing, payments, and scout accounts</li>
            <li><strong>Leader</strong> – Unit access: manage scouts, events, and view accounts</li>
            <li><strong>Parent</strong> – Family access: view and manage their own scouts&apos; accounts</li>
            <li><strong>Scout</strong> – View only: view events and their own account</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  ) : null

  // Data Tab Content
  const dataTabContent = (
    <div className="grid gap-6">
      <ScoutbookSyncCardLazy
        lastSyncAt={lastSyncSession?.completed_at}
        lastSyncMemberCount={lastSyncSession?.records_extracted}
        isAdmin={isAdmin}
      />
      <BalanceImportCard
        batches={importBatches}
        canUndoLatest={canUndoLatestBatch}
      />
      <BillingChargeImportCard
        batches={billingBatches}
      />
      <CollectionSettingsCard
        unitId={unit.id}
        settings={unit.collection_settings || {
          overdue_threshold_days: 30,
          overdue_threshold_amount_cents: 0,
          reminder_email_subject: 'Payment Reminder - {unit_name}',
          reminder_email_template: 'default',
        }}
      />
    </div>
  )

  // Integrations Tab Content
  const integrationsTabContent = (
    <div className="grid gap-6">
      <PaymentProcessingCard
        isConnected={!!squareCredentials}
        merchantId={squareCredentials?.merchant_id}
        connectedAt={squareCredentials?.connected_at}
        lastSyncAt={squareCredentials?.last_sync_at}
        environment={(process.env.SQUARE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production'}
        unitId={membership.unit_id}
        processingFeePercent={Number(unit.processing_fee_percent) || 0.026}
        processingFeeFixed={Number(unit.processing_fee_fixed) || 0.1}
        passFeesToPayer={unit.pass_fees_to_payer || false}
        effectiveRate={effectiveRate}
        isAdmin={isAdmin}
      />

      {bankIntegrationEnabled && (
        <BankConnectionCard
          connection={bankConnection}
          isAdmin={isAdmin}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-stone-400">Coming Soon</span>
          </CardTitle>
          <CardDescription>
            More integrations will be available in future updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-stone-500 space-y-1">
            <li>Stripe payments</li>
            <li>QuickBooks sync</li>
            <li>Google Calendar</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )

  // Determine default tab based on role and URL param
  const defaultTab = params.tab || (isAdmin ? 'unit' : 'data')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-stone-600">
          Configure your unit settings and data
        </p>
      </div>

      {params.success && (
        <div className="rounded-lg bg-success-light border border-success p-4 text-success">
          {params.success}
        </div>
      )}

      {params.error && (
        <div className="rounded-lg bg-error-light border border-error p-4 text-error">
          {params.error}
        </div>
      )}

      <SettingsTabs
        defaultTab={defaultTab}
        isAdmin={isAdmin}
        unitTabContent={unitTabContent}
        usersTabContent={usersTabContent}
        dataTabContent={dataTabContent}
        integrationsTabContent={integrationsTabContent}
      />
    </div>
  )
}
