'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import { trackBillingCreated } from '@/lib/analytics'
import { Zap } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_accounts: { id: string } | null
  patrols: { name: string } | null
}

interface Event {
  id: string
  title: string
  start_date: string
  cost_per_scout: number | null
}

interface QuickBillingFormProps {
  unitId: string
  scouts: Scout[]
  events: Event[]
}

export function QuickBillingForm({ unitId, scouts, events }: QuickBillingFormProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState('')

  // Filter to events with costs
  const billableEvents = useMemo(
    () => events.filter((e) => e.cost_per_scout && e.cost_per_scout > 0),
    [events]
  )

  const selectedEvent = billableEvents.find((e) => e.id === selectedEventId)
  const amount = selectedEvent?.cost_per_scout || 0
  const description = selectedEvent?.title || ''

  // All active scouts are selected by default
  const selectedScouts = useMemo(() => new Set(scouts.map((s) => s.id)), [scouts])

  const totalAmount = amount * selectedScouts.size

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (!selectedEvent) {
      setError('Please select an event')
      setIsLoading(false)
      return
    }

    const supabase = createClient()

    try {
      const selectedScoutAccounts = scouts.map((s) => ({
        scoutId: s.id,
        accountId: s.scout_accounts?.id,
        scoutName: `${s.first_name} ${s.last_name}`,
      }))

      const missingAccounts = selectedScoutAccounts.filter((s) => !s.accountId)
      if (missingAccounts.length > 0) {
        setError(`Some scouts don't have accounts: ${missingAccounts.map((s) => s.scoutName).join(', ')}`)
        setIsLoading(false)
        return
      }

      const billingDate = new Date().toISOString().split('T')[0]

      const { data, error: rpcError } = await supabase.rpc('create_billing_with_journal', {
        p_unit_id: unitId,
        p_description: description,
        p_total_amount: totalAmount,
        p_billing_date: billingDate,
        p_billing_type: 'fixed',
        p_per_scout_amount: amount,
        p_scout_accounts: selectedScoutAccounts,
      })

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      const result = data as { success: boolean; billing_record_id: string; journal_entry_id: string } | null
      if (!result?.success) {
        throw new Error('Failed to create billing record')
      }

      trackBillingCreated({
        total: totalAmount,
        scoutCount: selectedScouts.size,
        perScout: amount,
        billingType: 'fixed',
      })

      addToast({
        variant: 'success',
        title: 'Event billing created',
        description: `${formatCurrency(totalAmount)} charged for ${description}`,
      })

      setSelectedEventId('')
      setTimeout(() => router.refresh(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  if (billableEvents.length === 0) {
    return (
      <div className="text-center py-6 text-stone-500 dark:text-stone-400">
        <p>No upcoming events with costs set.</p>
        <p className="text-sm mt-1">Add event costs in the Events section to enable quick billing.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Event Selection */}
      <div className="space-y-2">
        <Label htmlFor="event">Select Event</Label>
        <select
          id="event"
          required
          disabled={isLoading}
          className="flex h-10 w-full rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 disabled:opacity-50"
          value={selectedEventId}
          onChange={(e) => setSelectedEventId(e.target.value)}
        >
          <option value="">Choose an event...</option>
          {billableEvents.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title} - {formatCurrency(event.cost_per_scout!)} per scout
            </option>
          ))}
        </select>
      </div>

      {/* Summary - only show when event selected */}
      {selectedEvent && (
        <div className="rounded-lg bg-forest-50 dark:bg-forest-900/20 border border-forest-200 dark:border-forest-700/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-forest-600 dark:text-forest-400" />
            <span className="font-medium text-forest-800 dark:text-forest-200">Quick Bill Preview</span>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-600 dark:text-stone-400">Event:</span>
              <span className="font-medium text-stone-900 dark:text-stone-100">{description}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600 dark:text-stone-400">Per Scout:</span>
              <span className="font-medium text-stone-900 dark:text-stone-100">{formatCurrency(amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600 dark:text-stone-400">Scouts:</span>
              <span className="font-medium text-stone-900 dark:text-stone-100">{selectedScouts.size} (all active)</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-forest-200 dark:border-forest-700/50">
              <span className="font-medium text-stone-700 dark:text-stone-300">Total:</span>
              <span className="font-bold text-forest-700 dark:text-forest-400">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-error-light p-3 text-sm font-medium text-error-dark">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        loading={isLoading}
        loadingText="Creating..."
        disabled={!selectedEvent}
        className="w-full gap-2"
      >
        <Zap className="h-4 w-4" />
        Bill All Scouts for {selectedEvent?.title || 'Event'}
      </Button>
    </form>
  )
}
