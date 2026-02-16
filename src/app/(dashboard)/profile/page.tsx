import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from '@/components/settings/profile-form'
import { ContactForm } from '@/components/settings/contact-form'
import { VenmoSettingsCard } from '@/components/settings/venmo-settings-card'
import { DangerZone } from '@/components/settings/danger-zone'

type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error || !profile) {
    redirect('/login')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-stone-600">Manage your personal information and account preferences</p>
      </div>

      <div className="grid gap-6">
        <ProfileForm
          profile={{
            first_name: profile.first_name,
            last_name: profile.last_name,
            gender: profile.gender as Gender | null,
            address_street: profile.address_street,
            address_city: profile.address_city,
            address_state: profile.address_state,
            address_zip: profile.address_zip,
            email_secondary: profile.email_secondary,
            phone_primary: profile.phone_primary,
            phone_secondary: profile.phone_secondary,
          }}
        />

        <ContactForm
          profile={{
            email: user.email || profile.email || '',
            email_secondary: profile.email_secondary,
            phone_primary: profile.phone_primary,
            phone_secondary: profile.phone_secondary,
          }}
        />

        <VenmoSettingsCard venmoUsername={profile.venmo_username} />

        <DangerZone />
      </div>
    </div>
  )
}
