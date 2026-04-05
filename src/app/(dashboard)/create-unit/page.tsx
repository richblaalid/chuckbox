import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { CreateUnitWizard } from '@/components/onboarding/create-unit-wizard'

export default function CreateUnitPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/settings"
        className="inline-flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to settings
      </Link>

      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Create a New Unit
        </h1>
        <p className="text-stone-600 dark:text-stone-300">
          Add another unit to your ChuckBox account.
        </p>
      </div>

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-6 sm:p-8 shadow-lg">
        <CreateUnitWizard />
      </div>
    </div>
  )
}
