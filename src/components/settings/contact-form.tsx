'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { updateProfile, changeEmail } from '@/app/actions/profile'

interface ContactFormProps {
  profile: {
    email: string
    email_secondary: string | null
    phone_home: string | null
    phone_mobile: string | null
  }
}

export function ContactForm({ profile }: ContactFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handlePhoneSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)

    const result = await updateProfile({
      email_secondary: formData.get('email_secondary') as string || null,
      phone_home: formData.get('phone_home') as string || null,
      phone_mobile: formData.get('phone_mobile') as string || null,
    })

    setIsLoading(false)

    if (result.success) {
      setMessage({ type: 'success', text: 'Contact information updated!' })
    } else {
      setMessage({ type: 'error', text: result.error || 'Failed to update' })
    }
  }

  async function handleEmailChange() {
    if (!newEmail.trim()) {
      setMessage({ type: 'error', text: 'Please enter a new email address' })
      return
    }

    setIsLoading(true)
    setMessage(null)

    const result = await changeEmail(newEmail)

    setIsLoading(false)

    if (result.success) {
      setMessage({
        type: 'success',
        text: 'Verification email sent! Check your new email to confirm the change.',
      })
      setIsChangingEmail(false)
      setNewEmail('')
    } else {
      setMessage({ type: 'error', text: result.error || 'Failed to change email' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact Information</CardTitle>
        <CardDescription>Manage your email and phone numbers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Primary Email Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-stone-700">Primary Email (Login)</h4>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                value={profile.email}
                disabled
                className="bg-stone-50"
              />
            </div>
            {!isChangingEmail && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsChangingEmail(true)}
              >
                Change
              </Button>
            )}
          </div>

          {isChangingEmail && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm text-stone-600">
                Enter your new email address. You will receive a verification email to confirm the change.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  placeholder="New email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={handleEmailChange}
                  loading={isLoading}
                  loadingText="Sending..."
                >
                  Send Verification
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsChangingEmail(false)
                    setNewEmail('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Phone and Secondary Email Form */}
        <form onSubmit={handlePhoneSubmit} className="space-y-4">
          {/* Secondary Email */}
          <div className="space-y-2">
            <Label htmlFor="email_secondary">Secondary Email</Label>
            <Input
              id="email_secondary"
              name="email_secondary"
              type="email"
              defaultValue={profile.email_secondary || ''}
              placeholder="Enter secondary email"
            />
          </div>

          {/* Phone Fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone_home">Home Phone</Label>
              <Input
                id="phone_home"
                name="phone_home"
                type="tel"
                defaultValue={profile.phone_home || ''}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone_mobile">Mobile Phone</Label>
              <Input
                id="phone_mobile"
                name="phone_mobile"
                type="tel"
                defaultValue={profile.phone_mobile || ''}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {message && (
            <div
              className={`rounded-md p-3 text-sm ${
                message.type === 'success'
                  ? 'bg-success-light text-success'
                  : 'bg-error-light text-error'
              }`}
            >
              {message.text}
            </div>
          )}

          <Button type="submit" loading={isLoading} loadingText="Saving...">
            Save Contact Info
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
