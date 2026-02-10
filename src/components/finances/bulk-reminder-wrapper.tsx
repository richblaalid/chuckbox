'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BulkReminderDialog } from '@/components/collection/bulk-reminder-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface OverdueAccount {
  id: string
  billing_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: { name: string } | null
  } | null
  oldest_unpaid_date: string | null
  days_overdue: number
  guardians: {
    profile_id: string
    profiles: {
      id: string
      email: string | null
      first_name: string | null
      last_name: string | null
    } | null
  }[]
}

interface BulkReminderWrapperProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedAccountIds: string[]
  unitId: string
  unitName: string
  onSuccess: () => void
}

export function BulkReminderWrapper({
  open,
  onOpenChange,
  selectedAccountIds,
  unitId,
  unitName,
  onSuccess,
}: BulkReminderWrapperProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [accounts, setAccounts] = useState<OverdueAccount[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || selectedAccountIds.length === 0) {
      setAccounts([])
      setIsLoading(false)
      return
    }

    async function fetchAccountData() {
      setIsLoading(true)
      setError(null)

      try {
        const supabase = createClient()

        // Fetch accounts with scouts and guardians
        const { data: accountsData, error: accountsError } = await supabase
          .from('scout_accounts')
          .select(`
            id,
            billing_balance,
            scout_id,
            scouts (
              id,
              first_name,
              last_name,
              is_active,
              patrols (name)
            )
          `)
          .in('id', selectedAccountIds)
          .lt('billing_balance', 0)

        if (accountsError) throw accountsError

        // Get oldest unpaid charges for each account
        const { data: chargesData } = await supabase
          .from('billing_charges')
          .select(`
            scout_account_id,
            billing_records!inner (billing_date)
          `)
          .in('scout_account_id', selectedAccountIds)
          .eq('is_paid', false)
          .or('is_void.is.null,is_void.eq.false')
          .order('billing_records(billing_date)', { ascending: true })

        const oldestByAccount: Record<string, string> = {}
        for (const charge of chargesData || []) {
          const accountId = charge.scout_account_id
          const billingDate = (charge.billing_records as { billing_date: string }).billing_date
          if (!oldestByAccount[accountId]) {
            oldestByAccount[accountId] = billingDate
          }
        }

        // Get guardian profiles for each scout
        const scoutIds = (accountsData || [])
          .map(a => a.scouts?.id)
          .filter(Boolean) as string[]

        const { data: guardiansData } = await supabase
          .from('scout_guardians')
          .select(`
            scout_id,
            profile_id,
            profiles (
              id,
              email,
              first_name,
              last_name
            )
          `)
          .in('scout_id', scoutIds)

        // Build guardian lookup by scout_id
        type GuardianData = NonNullable<typeof guardiansData>[number]
        const guardiansByScout: Record<string, GuardianData[]> = {}
        for (const g of guardiansData || []) {
          if (!guardiansByScout[g.scout_id]) {
            guardiansByScout[g.scout_id] = []
          }
          guardiansByScout[g.scout_id]!.push(g)
        }

        // Transform to OverdueAccount format
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const overdueAccounts: OverdueAccount[] = (accountsData || []).map(acc => {
          const oldestDate = oldestByAccount[acc.id] || null
          let daysOverdue = 0
          if (oldestDate) {
            const chargeDate = new Date(oldestDate)
            chargeDate.setHours(0, 0, 0, 0)
            daysOverdue = Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24))
          }

          const scoutId = acc.scouts?.id
          const guardians = scoutId
            ? (guardiansByScout[scoutId] || []).map(g => ({
                profile_id: g.profile_id,
                profiles: g.profiles as {
                  id: string
                  email: string | null
                  first_name: string | null
                  last_name: string | null
                } | null,
              }))
            : []

          return {
            id: acc.id,
            billing_balance: acc.billing_balance ?? 0,
            scout_id: acc.scout_id,
            scouts: acc.scouts as OverdueAccount['scouts'],
            oldest_unpaid_date: oldestDate,
            days_overdue: daysOverdue,
            guardians,
          }
        })

        setAccounts(overdueAccounts)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load account data')
      } finally {
        setIsLoading(false)
      }
    }

    fetchAccountData()
  }, [open, selectedAccountIds])

  if (!open) return null

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  if (error) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-error">{error}</p>
        </DialogContent>
      </Dialog>
    )
  }

  if (accounts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>No Accounts</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            None of the selected accounts have outstanding balances.
          </p>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <BulkReminderDialog
      open={open}
      onOpenChange={onOpenChange}
      accounts={accounts}
      unitId={unitId}
      unitName={unitName}
      onSuccess={onSuccess}
    />
  )
}
