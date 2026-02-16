'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { updateProfile } from '@/app/actions/profile'

interface VenmoSettingsCardProps {
  venmoUsername: string | null
}

export function VenmoSettingsCard({ venmoUsername }: VenmoSettingsCardProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const username = (formData.get('venmo_username') as string)?.trim() || null

    const result = await updateProfile({
      venmo_username: username,
    })

    setIsLoading(false)

    if (result.success) {
      setMessage({ type: 'success', text: 'Venmo username saved!' })
    } else {
      setMessage({ type: 'error', text: result.error || 'Failed to save' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Settings</CardTitle>
        <CardDescription>
          Configure your payment preferences for reimbursements and cost sharing
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venmo_username">Venmo Username</Label>
            <div className="flex items-center gap-2">
              <span className="text-stone-500">@</span>
              <Input
                id="venmo_username"
                name="venmo_username"
                type="text"
                placeholder="your-username"
                defaultValue={venmoUsername || ''}
                className="flex-1"
              />
            </div>
            <p className="text-sm text-stone-500">
              Your Venmo username is used when other parents need to send you
              money for shared expenses. Find it in your Venmo app under your
              profile.
            </p>
          </div>

          {message && (
            <div
              className={`text-sm ${
                message.type === 'success' ? 'text-success' : 'text-error'
              }`}
            >
              {message.text}
            </div>
          )}

          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Venmo Username'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
