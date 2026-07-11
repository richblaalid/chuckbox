'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

interface SentryIdentifyProps {
  userId: string
  email?: string
  role?: string
  unitId?: string
}

export function SentryIdentify({ userId, email, role, unitId }: SentryIdentifyProps) {
  useEffect(() => {
    Sentry.setUser({ id: userId, email })
    Sentry.setTags({ role, unit_id: unitId })
  }, [userId, email, role, unitId])

  return null
}
