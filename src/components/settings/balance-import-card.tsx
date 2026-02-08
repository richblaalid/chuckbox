import Link from 'next/link'
import { DollarSign, Upload } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceImportCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle>Account Balances</CardTitle>
              <CardDescription>
                Import scout account balances from a CSV file
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-stone-600">
          Import starting balances for scout accounts from your existing
          financial records. This is useful when migrating from another system
          or setting up your unit for the first time.
        </p>

        <div className="rounded-md bg-stone-50 dark:bg-stone-900 p-3 text-xs text-stone-500">
          <p className="font-medium text-stone-600 dark:text-stone-300">
            What you can import:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Billing balances (amounts owed to the unit)</li>
            <li>Fund balances (scout savings/credits)</li>
            <li>Match scouts by name or BSA Member ID</li>
          </ul>
        </div>

        <Link href="/settings/import/balances">
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Import Balances
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
