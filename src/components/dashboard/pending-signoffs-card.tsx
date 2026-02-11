import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPendingSignoffs } from '@/app/actions/advancement'
import { PendingSignoffsList } from './pending-signoffs-list'
import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'

interface PendingSignoffsCardProps {
  unitId: string
}

/**
 * Server component that fetches pending sign-offs and renders the card.
 * Only shown to management roles (admin, treasurer, leader).
 */
export async function PendingSignoffsCard({ unitId }: PendingSignoffsCardProps) {
  const pendingItems = await getPendingSignoffs(unitId, 5)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-forest-600" />
          <div>
            <CardTitle className="text-lg">Pending Sign-offs</CardTitle>
            <CardDescription>
              {pendingItems.length > 0
                ? `${pendingItems.length} requirement${pendingItems.length !== 1 ? 's' : ''} awaiting approval`
                : 'All caught up!'}
            </CardDescription>
          </div>
        </div>
        {pendingItems.length > 0 && (
          <Link
            href="/advancement?tab=pending"
            className="text-sm text-forest-600 hover:text-forest-800 hover:underline"
          >
            View all
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <PendingSignoffsList items={pendingItems} />
      </CardContent>
    </Card>
  )
}
