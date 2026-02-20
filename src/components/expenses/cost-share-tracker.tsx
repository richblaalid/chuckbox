'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { generateVenmoPaymentLink } from '@/lib/expenses/venmo'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { CostShareEventGroup, CostShareRow } from '@/lib/expenses/cost-sharing'

interface CostShareTrackerProps {
  groups: CostShareEventGroup[]
  onMarkPaid: (shareId: string) => Promise<void>
  onDelete: (shareId: string) => Promise<void>
}

interface ProgressBarProps {
  paid: number
  total: number
}

interface ShareRowProps {
  share: CostShareRow
  organizerVenmo: string | null
  eventDescription: string
  onMarkPaid: (shareId: string) => Promise<void>
  onDelete: (shareId: string) => Promise<void>
}

interface EventGroupCardProps {
  group: CostShareEventGroup
  onMarkPaid: (shareId: string) => Promise<void>
  onDelete: (shareId: string) => Promise<void>
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
}

function scoutLabel(count: number): string {
  return `${count} scout${count !== 1 ? 's' : ''}`
}

function ProgressBar({ paid, total }: ProgressBarProps): React.ReactNode {
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-full bg-stone-200">
        <div
          className="h-2 rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-stone-600 whitespace-nowrap">
        {paid} of {total} paid
      </span>
    </div>
  )
}

function ShareRow({
  share,
  organizerVenmo,
  eventDescription,
  onMarkPaid,
  onDelete,
}: ShareRowProps): React.ReactNode {
  const [loading, setLoading] = useState<'pay' | 'delete' | null>(null)
  const isPending = share.status === 'pending'
  const isPaid = share.status === 'paid'
  const statusColor = statusStyles[share.status] || statusStyles.pending

  const venmoUrl =
    isPending && organizerVenmo
      ? generateVenmoPaymentLink({
          username: organizerVenmo,
          amount: share.share_amount,
          note: `${eventDescription} (${scoutLabel(share.scout_count)})`,
        })
      : null

  async function handleMarkPaid() {
    setLoading('pay')
    try {
      await onMarkPaid(share.id)
    } finally {
      setLoading(null)
    }
  }

  async function handleDelete() {
    setLoading('delete')
    try {
      await onDelete(share.id)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-900 truncate">
            {share.participant.full_name || share.participant.email || 'Unknown'}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
              statusColor
            )}
          >
            {share.status}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
          <span>{scoutLabel(share.scout_count)}</span>
          {share.participant.venmo_username && (
            <>
              <span className="text-stone-300">&middot;</span>
              <span>@{share.participant.venmo_username}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={cn(
            'text-sm font-semibold',
            isPaid ? 'text-green-700' : 'text-stone-900'
          )}
        >
          {formatCurrency(share.share_amount)}
        </span>

        {isPending && (
          <>
            {venmoUrl && (
              <Button variant="ghost" size="sm" asChild>
                <a href={venmoUrl} target="_blank" rel="noopener noreferrer">
                  Venmo
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800"
              onClick={handleMarkPaid}
              disabled={loading !== null}
            >
              {loading === 'pay' ? 'Saving...' : 'Mark Paid'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-stone-400 hover:text-red-600"
              onClick={handleDelete}
              disabled={loading !== null}
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function EventGroupCard({
  group,
  onMarkPaid,
  onDelete,
}: EventGroupCardProps): React.ReactNode {
  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-stone-900">{group.description}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
              <span>{formatDate(group.createdAt)}</span>
              <span className="text-stone-300">&middot;</span>
              <span>{scoutLabel(group.totalScouts)}</span>
              <span className="text-stone-300">&middot;</span>
              <span>{formatCurrency(group.perScoutAmount)}/scout</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="text-xl font-bold text-stone-900">
              {formatCurrency(group.totalAmount)}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <ProgressBar paid={group.paidCount} total={group.totalShares} />
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>
              {formatCurrency(group.totalCollected)} collected
            </span>
            {group.totalPending > 0 && (
              <span>{formatCurrency(group.totalPending)} pending</span>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {group.shares.map((share) => (
            <ShareRow
              key={share.id}
              share={share}
              organizerVenmo={group.organizerVenmo}
              eventDescription={group.description}
              onMarkPaid={onMarkPaid}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function CostShareTracker({
  groups,
  onMarkPaid,
  onDelete,
}: CostShareTrackerProps): React.ReactNode {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
        <p className="text-stone-500">No cost shares yet</p>
        <p className="mt-1 text-sm text-stone-400">
          Split an expense to start tracking payments from other families.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <EventGroupCard
          key={group.description + group.createdAt}
          group={group}
          onMarkPaid={onMarkPaid}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
