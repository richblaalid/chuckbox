'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScoutsList } from '@/components/scouts/scouts-list'
import { AdultsList } from './adults-list'
import { AddScoutButton } from '@/components/scouts/add-scout-button'
import { AddAdultButton } from './add-adult-button'

interface Scout {
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
  email?: string | null
  email_secondary?: string | null
  phone_home?: string | null
  phone_mobile?: string | null
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  member_type: string | null
  position: string | null
  position_2: string | null
  bsa_member_id: string | null
  renewal_status: string | null
  expiration_date: string | null
  is_active: boolean | null
  user_id: string | null  // indicates if they have an app account
}

interface RosterTabsProps {
  scouts: Scout[]
  adults: RosterAdult[]
  canManageScouts: boolean
  canManageAdults: boolean
  unitId: string
}

export function RosterTabs({ scouts, adults, canManageScouts, canManageAdults, unitId }: RosterTabsProps) {
  const [activeTab, setActiveTab] = useState('scouts')

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <div className="flex items-center justify-between mb-4">
        <TabsList>
          <TabsTrigger value="scouts">
            Scouts ({scouts.length})
          </TabsTrigger>
          <TabsTrigger value="adults">
            Adults ({adults.length})
          </TabsTrigger>
        </TabsList>

        {/* Contextual action button */}
        {activeTab === 'scouts' && canManageScouts && (
          <AddScoutButton unitId={unitId} />
        )}
        {activeTab === 'adults' && canManageAdults && (
          <AddAdultButton unitId={unitId} />
        )}
      </div>

      <TabsContent value="scouts">
        <ScoutsList scouts={scouts} canManage={canManageScouts} unitId={unitId} />
      </TabsContent>
      <TabsContent value="adults">
        <AdultsList adults={adults} canManage={canManageAdults} unitId={unitId} />
      </TabsContent>
    </Tabs>
  )
}
