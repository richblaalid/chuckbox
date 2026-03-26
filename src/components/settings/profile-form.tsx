'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { updateProfile } from '@/app/actions/profile'

type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say'

interface ProfileFormProps {
  profile: {
    first_name: string | null
    last_name: string | null
    gender: Gender | null
    address_street: string | null
    address_city: string | null
    address_state: string | null
    address_zip: string | null
    email_secondary: string | null
    phone_home: string | null
    phone_mobile: string | null
  }
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    const genderValue = formData.get('gender') as string
    const result = await updateProfile({
      first_name: formData.get('first_name') as string || null,
      last_name: formData.get('last_name') as string || null,
      gender: genderValue && genderValue !== '' ? genderValue as Gender : null,
      address_street: formData.get('address_street') as string || null,
      address_city: formData.get('address_city') as string || null,
      address_state: formData.get('address_state') as string || null,
      address_zip: formData.get('address_zip') as string || null,
      email_secondary: formData.get('email_secondary') as string || null,
      phone_home: formData.get('phone_home') as string || null,
      phone_mobile: formData.get('phone_mobile') as string || null,
    })

    setIsLoading(false)

    if (result.success) {
      addToast({
        variant: 'success',
        title: 'Profile updated',
        description: 'Your personal information has been saved.',
      })
    } else {
      setError(result.error || 'Failed to update profile')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
        <CardDescription>Update your personal details and address</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name Fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                name="first_name"
                defaultValue={profile.first_name || ''}
                placeholder="Enter first name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                name="last_name"
                defaultValue={profile.last_name || ''}
                placeholder="Enter last name"
              />
            </div>
          </div>

          {/* Gender Field */}
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select name="gender" defaultValue={profile.gender || ''}>
              <SelectTrigger id="gender" className="sm:max-w-xs">
                <SelectValue placeholder="Select gender..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
                <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-stone-500">
              Used for assigning you to the appropriate section in coed troops
            </p>
          </div>

          {/* Address Fields */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-stone-700">Address</h4>
            <div className="space-y-2">
              <Label htmlFor="address_street">Street Address</Label>
              <Input
                id="address_street"
                name="address_street"
                defaultValue={profile.address_street || ''}
                placeholder="Enter street address"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="address_city">City</Label>
                <Input
                  id="address_city"
                  name="address_city"
                  defaultValue={profile.address_city || ''}
                  placeholder="City"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_state">State</Label>
                <Input
                  id="address_state"
                  name="address_state"
                  defaultValue={profile.address_state || ''}
                  placeholder="State"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_zip">ZIP Code</Label>
                <Input
                  id="address_zip"
                  name="address_zip"
                  defaultValue={profile.address_zip || ''}
                  placeholder="ZIP"
                  maxLength={10}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-error-light p-3 text-sm text-error">
              {error}
            </div>
          )}

          <Button type="submit" loading={isLoading} loadingText="Saving...">
            Save Changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
