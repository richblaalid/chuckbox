'use client'

import { useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface ProfileTabsProps {
  profileContent: React.ReactNode
  expensesContent: React.ReactNode
  expenseCount?: number
}

export function ProfileTabs({
  profileContent,
  expensesContent,
  expenseCount,
}: ProfileTabsProps) {
  const searchParams = useSearchParams()
  const defaultTab = searchParams.get('tab') === 'expenses' ? 'expenses' : 'profile'

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="expenses">
          Expenses
          {expenseCount !== undefined && expenseCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-stone-200 px-1.5 text-xs font-medium text-stone-700">
              {expenseCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        {profileContent}
      </TabsContent>

      <TabsContent value="expenses">
        {expensesContent}
      </TabsContent>
    </Tabs>
  )
}
