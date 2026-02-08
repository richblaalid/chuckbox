import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isFinancialRole } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BalanceImportWizard } from '@/components/import/balance-import-wizard'
import { ArrowLeft, Users } from 'lucide-react'

export default async function BalanceImportPage() {
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

  // Get user's membership
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership) {
    redirect('/login')
  }

  // Only admin and treasurer can access this page
  if (!isFinancialRole(membership.role)) {
    redirect('/profile')
  }

  // Fetch scouts with their accounts
  const { data: scoutsData } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      bsa_member_id,
      scout_accounts (
        id,
        billing_balance,
        funds_balance
      )
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')
    .order('first_name')

  interface Scout {
    id: string
    first_name: string
    last_name: string
    bsa_member_id: string | null
    scout_accounts: {
      id: string
      billing_balance: number | null
      funds_balance: number
    } | null
  }

  const scouts = (scoutsData as Scout[]) || []

  return (
    <div className="space-y-6">
      {/* Header with back link */}
      <div className="flex items-center gap-4">
        <Link href="/settings?tab=data">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-stone-900">Import Account Balances</h1>
        <p className="mt-1 text-stone-600">
          Import scout account balances from a CSV file to set or adjust billing and funds balances
        </p>
      </div>

      {/* No scouts message */}
      {scouts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              No Scouts Found
            </CardTitle>
            <CardDescription>
              You need to import your roster before importing account balances
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-stone-600 mb-4">
              Account balances are tied to individual scouts. Import your unit roster first to create scout records, then return here to import their balances.
            </p>
            <Link href="/settings/import">
              <Button>Import Roster</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <BalanceImportWizard scouts={scouts} />
      )}
    </div>
  )
}
