'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { ScoutGuardianAssociations } from './scout-guardian-associations'
import { ScoutAdvancementSection } from '@/components/advancement/scout-advancement-section'
import { PaginatedTransactionHistory } from '@/components/finances/paginated-transaction-history'
import {
  Award,
  User,
  Wallet,
  Shield,
  MapPin,
  CreditCard,
} from 'lucide-react'

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
  unit_id: string
  scout_accounts: { id: string; billing_balance: number | null; funds_balance: number } | null
  patrols: { name: string } | null
}

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

interface AvailableProfile {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: string | null
  member_type: string | null
  user_id: string | null
}

interface AdvancementData {
  rankProgress: Array<{
    id: string
    status: string
    started_at: string | null
    completed_at: string | null
    approved_at: string | null
    awarded_at: string | null
    bsa_ranks: {
      id: string
      code: string
      name: string
      display_order: number
      image_url?: string | null
    }
    scout_rank_requirement_progress: Array<{
      id: string
      status: string
      completed_at: string | null
      completed_by: string | null
      notes: string | null
      approval_status: string | null
      bsa_rank_requirements: {
        id: string
        requirement_number: string
        description: string
        parent_requirement_id: string | null
        is_alternative: boolean | null
        alternatives_group: string | null
      }
    }>
  }>
  meritBadgeProgress: Array<{
    id: string
    status: string
    started_at: string | null
    completed_at: string | null
    awarded_at: string | null
    counselor_name: string | null
    bsa_merit_badges: {
      id: string
      code: string | null
      name: string
      is_eagle_required: boolean | null
      category: string | null
    }
    scout_merit_badge_requirement_progress: Array<{
      id: string
      status: string
      completed_at: string | null
    }>
  }>
  leadershipHistory: Array<{
    id: string
    start_date: string
    end_date: string | null
    notes: string | null
    bsa_leadership_positions: {
      id: string
      code: string | null
      name: string
      qualifies_for_star: boolean | null
      qualifies_for_life: boolean | null
      qualifies_for_eagle: boolean | null
      min_tenure_months: number | null
    }
  }>
  activityEntries: Array<{
    id: string
    activity_type: 'camping' | 'hiking' | 'service' | 'conservation'
    activity_date: string
    value: number
    description: string | null
    location: string | null
  }>
  activityTotals: {
    camping: number
    hiking: number
    service: number
    conservation: number
  }
}

interface ScoutProfileTabsProps {
  scout: Scout
  guardians: Guardian[]
  availableProfiles: AvailableProfile[]
  advancementData: AdvancementData | null
  advancementEnabled: boolean
  canEditScout: boolean
  canEditGuardians: boolean
}

export function ScoutProfileTabs({
  scout,
  guardians,
  availableProfiles,
  advancementData,
  advancementEnabled,
  canEditScout,
  canEditGuardians,
}: ScoutProfileTabsProps) {
  const [activeTab, setActiveTab] = useState(advancementEnabled ? 'advancement' : 'profile')

  const scoutAccount = scout.scout_accounts
  const billingBalance = scoutAccount?.billing_balance ?? 0
  const fundsBalance = scoutAccount?.funds_balance ?? 0

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="mb-6 grid w-full max-w-md grid-cols-2">
        {advancementEnabled && (
          <TabsTrigger value="advancement" className="gap-2">
            <Award className="h-4 w-4" />
            Advancement
          </TabsTrigger>
        )}
        <TabsTrigger value="profile" className="gap-2">
          <User className="h-4 w-4" />
          Profile
        </TabsTrigger>
      </TabsList>

      {/* Advancement Tab */}
      {advancementEnabled && advancementData && (
        <TabsContent value="advancement" className="mt-0">
          <ScoutAdvancementSection
            scoutId={scout.id}
            unitId={scout.unit_id}
            scoutName={`${scout.first_name} ${scout.last_name}`}
            currentRank={scout.rank}
            rankProgress={advancementData.rankProgress}
            meritBadgeProgress={advancementData.meritBadgeProgress}
            leadershipHistory={advancementData.leadershipHistory}
            activityEntries={advancementData.activityEntries}
            activityTotals={advancementData.activityTotals}
            canEdit={canEditScout}
          />
        </TabsContent>
      )}

      {/* Profile Tab */}
      <TabsContent value="profile" className="mt-0 space-y-6">
        {/* Quick Stats Row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Scout Funds */}
          <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-green-50/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                  <Wallet className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-emerald-700">Scout Funds</p>
                  <p className={`text-xl font-bold ${fundsBalance > 0 ? 'text-emerald-700' : 'text-stone-700'}`}>
                    {formatCurrency(fundsBalance)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Money Owed */}
          <Card className={billingBalance < 0 ? 'border-red-100 bg-gradient-to-br from-red-50/50 to-orange-50/30' : 'border-stone-100'}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${billingBalance < 0 ? 'bg-red-100' : 'bg-stone-100'}`}>
                  <CreditCard className={`h-5 w-5 ${billingBalance < 0 ? 'text-red-600' : 'text-stone-500'}`} />
                </div>
                <div>
                  <p className={`text-xs font-medium ${billingBalance < 0 ? 'text-red-700' : 'text-stone-500'}`}>Money Owed</p>
                  <p className={`text-xl font-bold ${billingBalance < 0 ? 'text-red-700' : 'text-stone-700'}`}>
                    {billingBalance < 0 ? formatCurrency(Math.abs(billingBalance)) : '$0.00'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Patrol */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                  <MapPin className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500">Patrol</p>
                  <p className="text-lg font-semibold text-stone-900">
                    {scout.patrols?.name || 'Unassigned'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rank */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                  <Award className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500">Rank</p>
                  <p className="text-lg font-semibold text-stone-900">
                    {scout.rank || 'Not set'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Scout Information */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-forest-600" />
                Scout Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scout.current_position && (
                <div className="flex justify-between">
                  <span className="text-sm text-stone-500">Position</span>
                  <span className="text-sm font-medium">{scout.current_position}</span>
                </div>
              )}
              {scout.date_of_birth && (
                <div className="flex justify-between">
                  <span className="text-sm text-stone-500">Date of Birth</span>
                  <span className="text-sm font-medium">{scout.date_of_birth}</span>
                </div>
              )}
              {scout.bsa_member_id && (
                <div className="flex justify-between">
                  <span className="text-sm text-stone-500">BSA Member ID</span>
                  <span className="text-sm font-medium">{scout.bsa_member_id}</span>
                </div>
              )}
              {scout.date_joined && (
                <div className="flex justify-between">
                  <span className="text-sm text-stone-500">Date Joined</span>
                  <span className="text-sm font-medium">{scout.date_joined}</span>
                </div>
              )}
              {!scout.current_position && !scout.date_of_birth && !scout.bsa_member_id && !scout.date_joined && (
                <p className="text-sm text-stone-400">No additional information</p>
              )}
            </CardContent>
          </Card>

          {/* Health & Safety */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-forest-600" />
                Health & Safety
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Health Form */}
              <div>
                <p className="mb-1 text-sm text-stone-500">Health Form</p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      scout.health_form_status === 'current'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : scout.health_form_status === 'expired'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-stone-200 bg-stone-50 text-stone-600'
                    }
                  >
                    {scout.health_form_status
                      ? scout.health_form_status.charAt(0).toUpperCase() + scout.health_form_status.slice(1)
                      : 'Unknown'}
                  </Badge>
                  {scout.health_form_expires && (
                    <span className="text-xs text-stone-500">
                      Expires: {scout.health_form_expires}
                    </span>
                  )}
                </div>
              </div>

              {/* Swim Classification */}
              <div>
                <p className="mb-1 text-sm text-stone-500">Swim Classification</p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      scout.swim_classification === 'swimmer'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : scout.swim_classification === 'beginner'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : scout.swim_classification === 'non-swimmer'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-stone-200 bg-stone-50 text-stone-600'
                    }
                  >
                    {scout.swim_classification
                      ? scout.swim_classification.charAt(0).toUpperCase() + scout.swim_classification.slice(1).replace('-', ' ')
                      : 'Not recorded'}
                  </Badge>
                  {scout.swim_class_date && (
                    <span className="text-xs text-stone-500">
                      Tested: {scout.swim_class_date}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-forest-600" />
                Account Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-stone-500">Scout Funds</span>
                <span className={`text-sm font-medium ${fundsBalance > 0 ? 'text-emerald-600' : ''}`}>
                  {formatCurrency(fundsBalance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-stone-500">Money Owed</span>
                <span className={`text-sm font-medium ${billingBalance < 0 ? 'text-red-600' : ''}`}>
                  {billingBalance < 0 ? formatCurrency(Math.abs(billingBalance)) : '$0.00'}
                </span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-stone-700">Net Balance</span>
                  <span className={`text-sm font-bold ${fundsBalance + billingBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(fundsBalance + billingBalance)}
                  </span>
                </div>
              </div>
              {scoutAccount && (
                <Link
                  href={`/finances/accounts/${scoutAccount.id}`}
                  className="mt-2 inline-block text-sm text-forest-600 hover:text-forest-800 hover:underline"
                >
                  View full account details &rarr;
                </Link>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Guardians Section */}
        <ScoutGuardianAssociations
          unitId={scout.unit_id}
          scoutId={scout.id}
          scoutName={`${scout.first_name} ${scout.last_name}`}
          guardians={guardians}
          availableProfiles={availableProfiles}
          canEdit={canEditGuardians}
        />

        {/* Transaction History */}
        {scoutAccount && (
          <PaginatedTransactionHistory
            scoutAccountId={scoutAccount.id}
            title="Transaction History"
            description="All transactions on this scout's account"
          />
        )}
      </TabsContent>
    </Tabs>
  )
}
