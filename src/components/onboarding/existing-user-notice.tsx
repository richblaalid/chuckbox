'use client'

import Link from 'next/link'
import { UserCheck, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/ui/page-transition'

interface ExistingUserNoticeProps {
  email: string
  onBack: () => void
}

export function ExistingUserNotice({ email, onBack }: ExistingUserNoticeProps) {
  return (
    <FadeIn className="text-center py-8">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-forest-100 dark:bg-forest-900/30 text-forest-600 dark:text-forest-400 mb-4">
        <UserCheck className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
        You already have an account
      </h2>
      <p className="text-stone-600 dark:text-stone-300 max-w-md mx-auto">
        An account with <strong>{email}</strong> already exists.
        Sign in to create a new unit with your existing account.
      </p>

      <div className="mt-8 flex flex-col gap-3 max-w-xs mx-auto">
        <Button asChild>
          <Link href={`/login?next=/create-unit`}>
            Sign In to Continue
          </Link>
        </Button>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <p className="text-sm text-stone-500 dark:text-stone-400 mt-6">
        After signing in, you&apos;ll be able to create a new unit from your dashboard.
      </p>
    </FadeIn>
  )
}
