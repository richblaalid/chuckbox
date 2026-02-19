'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn, formatCurrency } from '@/lib/utils'
import {
  calculateCostShares,
  type ScoutWithGuardians,
  type CostShareResult,
} from '@/lib/expenses/cost-sharing'

interface CostSharingFormProps {
  unitId: string
  organizerProfileId: string
  organizerVenmo: string | null
  scouts: ScoutWithGuardians[]
  onSubmit: (data: {
    description: string
    totalAmount: number
    result: CostShareResult
  }) => Promise<{ success: boolean; error?: string }>
}

function scoutLabel(count: number): string {
  return `${count} scout${count !== 1 ? 's' : ''}`
}

function getOrganizersScoutIds(
  scouts: ScoutWithGuardians[],
  organizerProfileId: string
): Set<string> {
  return new Set(
    scouts
      .filter((s) =>
        s.guardians.some((g) => g.profile_id === organizerProfileId)
      )
      .map((s) => s.id)
  )
}

export function CostSharingForm({
  organizerProfileId,
  scouts,
  onSubmit,
}: CostSharingFormProps) {
  const organizerScoutIds = useMemo(
    () => getOrganizersScoutIds(scouts, organizerProfileId),
    [scouts, organizerProfileId]
  )

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedScoutIds, setSelectedScoutIds] = useState<Set<string>>(
    () => new Set(organizerScoutIds)
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalAmount = parseFloat(amount) || 0

  const sortedScouts = useMemo(
    () =>
      [...scouts].sort((a, b) => {
        const lastCmp = a.last_name.localeCompare(b.last_name)
        if (lastCmp !== 0) return lastCmp
        return a.first_name.localeCompare(b.first_name)
      }),
    [scouts]
  )

  const result = useMemo(() => {
    if (totalAmount <= 0 || selectedScoutIds.size === 0) return null
    return calculateCostShares({
      totalAmount,
      selectedScoutIds: Array.from(selectedScoutIds),
      scouts,
      organizerProfileId,
    })
  }, [totalAmount, selectedScoutIds, scouts, organizerProfileId])

  function toggleScout(scoutId: string): void {
    setSelectedScoutIds((prev) => {
      const next = new Set(prev)
      if (next.has(scoutId)) {
        next.delete(scoutId)
      } else {
        next.add(scoutId)
      }
      return next
    })
  }

  function selectAll(): void {
    setSelectedScoutIds(new Set(scouts.map((s) => s.id)))
  }

  function selectNone(): void {
    setSelectedScoutIds(new Set(organizerScoutIds))
  }

  async function handleSubmit(): Promise<void> {
    setError(null)

    if (!description.trim()) {
      setError('Please enter a description')
      return
    }
    if (totalAmount <= 0) {
      setError('Please enter a total amount')
      return
    }
    if (selectedScoutIds.size === 0) {
      setError('Please select at least one scout')
      return
    }
    if (!result || result.shares.length === 0) {
      setError(
        'No other families to split with. Select scouts from other families.'
      )
      return
    }

    setIsSubmitting(true)
    try {
      const submitResult = await onSubmit({
        description: description.trim(),
        totalAmount,
        result,
      })
      if (!submitResult.success) {
        setError(submitResult.error || 'Failed to create cost shares')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit =
    !isSubmitting &&
    description.trim().length > 0 &&
    totalAmount > 0 &&
    selectedScoutIds.size > 0 &&
    result != null &&
    result.shares.length > 0

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
          <CardDescription>
            Describe the expense you want to split among families
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cs-description">Description *</Label>
            <Input
              id="cs-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Campsite fee for Feb campout"
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-amount">Total Amount Paid *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">
                $
              </span>
              <Input
                id="cs-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Who Attended?</CardTitle>
              <CardDescription>
                Select the scouts who were part of this event.
                {selectedScoutIds.size > 0 && (
                  <span className="ml-1 font-medium text-stone-700">
                    {selectedScoutIds.size} selected
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={isSubmitting}
              >
                All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectNone}
                disabled={isSubmitting}
              >
                None
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1 sm:grid-cols-2">
            {sortedScouts.map((scout) => {
              const isOrganizers = organizerScoutIds.has(scout.id)
              const isSelected = selectedScoutIds.has(scout.id)
              return (
                <label
                  key={scout.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors',
                    isSelected ? 'bg-stone-100' : 'hover:bg-stone-50'
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleScout(scout.id)}
                    disabled={isSubmitting}
                  />
                  <span className="text-sm">
                    {scout.first_name} {scout.last_name}
                  </span>
                  {isOrganizers && (
                    <span className="ml-auto text-xs text-stone-400">
                      yours
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {scouts.length === 0 && (
            <p className="py-4 text-center text-sm text-stone-500">
              No scouts found in this unit.
            </p>
          )}
        </CardContent>
      </Card>

      {result && totalAmount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
            <CardDescription>
              {formatCurrency(totalAmount)} &divide; {scoutLabel(result.totalScouts)} ={' '}
              <span className="font-medium text-stone-700">
                {formatCurrency(result.perScoutAmount)}/scout
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.organizerScoutCount > 0 && (
              <div className="flex items-center justify-between rounded-md bg-stone-50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-stone-900">
                    Your share
                  </p>
                  <p className="text-xs text-stone-500">
                    {scoutLabel(result.organizerScoutCount)}
                  </p>
                </div>
                <span className="text-sm font-medium text-stone-700">
                  {formatCurrency(result.organizerAmount)}
                </span>
              </div>
            )}

            {result.shares.map((share) => (
              <div
                key={share.participantId}
                className="flex items-center justify-between rounded-md border border-stone-200 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-stone-900">
                    {share.participantName}
                  </p>
                  <p className="text-xs text-stone-500">
                    {scoutLabel(share.scoutCount)}
                    {share.participantVenmo && (
                      <span className="ml-1">
                        &middot; @{share.participantVenmo}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-sm font-semibold text-stone-900">
                  {formatCurrency(share.shareAmount)}
                </span>
              </div>
            ))}

            {result.shares.length === 0 && (
              <p className="py-2 text-center text-sm text-stone-500">
                Select scouts from other families to split costs.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {isSubmitting
            ? 'Creating...'
            : `Send Payment Requests (${result?.shares.length ?? 0})`}
        </Button>
      </div>
    </div>
  )
}
