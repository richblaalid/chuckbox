'use client'

import { useState, useEffect, useSyncExternalStore, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateRosterAdult, createRosterAdult, getAdultFormData } from '@/app/actions/roster'
import { addScoutGuardian, removeScoutGuardian } from '@/app/actions/users'
import { X, Plus, Loader2 } from 'lucide-react'

// Hook to detect client-side mount without triggering cascading renders
function useIsMounted() {
  const subscribe = useCallback(() => () => {}, [])
  const getSnapshot = useCallback(() => true, [])
  const getServerSnapshot = useCallback(() => false, [])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

const MEMBER_TYPES = [
  { value: 'LEADER', label: 'Leader' },
  { value: 'P 18+', label: 'Parent' },
]

const ROLES = [
  { value: 'leader', label: 'Leader', description: 'Manage scouts and events' },
  { value: 'parent', label: 'Parent', description: 'View and manage own scouts' },
  { value: 'treasurer', label: 'Treasurer', description: 'Manage billing and payments' },
  { value: 'admin', label: 'Admin', description: 'Full access to all unit features' },
] as const

type MemberRole = typeof ROLES[number]['value']

interface AdultData {
  id: string
  user_id: string | null // null means imported profile without app account
  first_name: string | null
  last_name: string | null
  email: string | null
  email_secondary: string | null
  phone_primary: string | null
  phone_secondary: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  member_type: string | null
  position: string | null
  position_2: string | null
  bsa_member_id: string | null
  is_active: boolean | null
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
}

interface Guardianship {
  id: string
  scout_id: string
  scout_name: string
  relationship: string | null
  is_primary: boolean | null
}

const RELATIONSHIPS = [
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'other', label: 'Other Family' },
]

interface AdultFormProps {
  unitId: string
  adult?: AdultData // Optional - undefined means create mode
  onClose: () => void
  onSuccess: () => void
}

export function AdultForm({ unitId, adult, onClose, onSuccess }: AdultFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [sendInvite, setSendInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState<MemberRole>('parent')

  // Scout linking state (edit mode only)
  const [scouts, setScouts] = useState<Scout[]>([])
  const [guardianships, setGuardianships] = useState<Guardianship[]>([])
  const [loadingScoutData, setLoadingScoutData] = useState(false)
  const [selectedScoutId, setSelectedScoutId] = useState('')
  const [selectedRelationship, setSelectedRelationship] = useState('parent')
  const [linkingScout, setLinkingScout] = useState(false)
  const [removingGuardianship, setRemovingGuardianship] = useState<string | null>(null)

  const isCreateMode = !adult

  // Use useSyncExternalStore for SSR-safe mount detection (avoids cascading renders)
  const mounted = useIsMounted()

  // Fetch scouts and guardianships when editing
  useEffect(() => {
    if (!isCreateMode && adult && mounted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: loading state for data fetch
      setLoadingScoutData(true)
      getAdultFormData(unitId, adult.id)
        .then(result => {
          if (result.success) {
            setScouts(result.scouts || [])
            setGuardianships(result.guardianships || [])
          }
        })
        .finally(() => setLoadingScoutData(false))
    }
  }, [isCreateMode, adult, unitId, mounted])

  // Get scouts that aren't already linked
  const availableScouts = scouts.filter(
    s => !guardianships.some(g => g.scout_id === s.id)
  )

  const handleAddGuardianship = async () => {
    if (!adult || !selectedScoutId) return
    setLinkingScout(true)
    setError(null)

    const result = await addScoutGuardian(unitId, adult.id, selectedScoutId, selectedRelationship)

    if (result.success) {
      // Find the scout name for display
      const scout = scouts.find(s => s.id === selectedScoutId)
      if (scout) {
        // We don't have the new guardianship ID, but we can add a placeholder
        // The page will refresh anyway when the form is closed
        setGuardianships([...guardianships, {
          id: `temp-${Date.now()}`,
          scout_id: selectedScoutId,
          scout_name: `${scout.first_name} ${scout.last_name}`,
          relationship: selectedRelationship,
          is_primary: false,
        }])
      }
      setSelectedScoutId('')
      setSelectedRelationship('parent')
      router.refresh()
    } else {
      setError(result.error || 'Failed to link scout')
    }
    setLinkingScout(false)
  }

  const handleRemoveGuardianship = async (guardianshipId: string) => {
    if (!adult) return
    setRemovingGuardianship(guardianshipId)
    setError(null)

    const result = await removeScoutGuardian(unitId, guardianshipId)

    if (result.success) {
      setGuardianships(guardianships.filter(g => g.id !== guardianshipId))
      router.refresh()
    } else {
      setError(result.error || 'Failed to unlink scout')
    }
    setRemovingGuardianship(null)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    setWarning(null)

    const formData = new FormData(e.currentTarget)

    if (isCreateMode) {
      // Create mode
      const firstName = formData.get('first_name') as string
      const lastName = formData.get('last_name') as string

      if (!firstName || !lastName) {
        setError('First name and last name are required')
        setIsLoading(false)
        return
      }

      const result = await createRosterAdult(unitId, {
        first_name: firstName,
        last_name: lastName,
        email: (formData.get('email') as string) || null,
        phone_primary: (formData.get('phone_primary') as string) || null,
        member_type: (formData.get('member_type') as string) || null,
        position: (formData.get('position') as string) || null,
        bsa_member_id: (formData.get('bsa_member_id') as string) || null,
        sendInvite,
        inviteRole: sendInvite ? inviteRole : undefined,
      })

      setIsLoading(false)

      if (result.success) {
        if (result.warning) {
          setWarning(result.warning)
          // Close after delay if there's a warning (adult was still created)
          setTimeout(() => {
            router.refresh()
            onSuccess()
          }, 2500)
          return
        }
        router.refresh()
        onSuccess()
      } else {
        setError(result.error || 'Failed to add adult')
      }
    } else {
      // Edit mode
      const result = await updateRosterAdult(unitId, adult.id, {
        first_name: (formData.get('first_name') as string) || null,
        last_name: (formData.get('last_name') as string) || null,
        email: adult.user_id ? null : (formData.get('email') as string) || null,
        email_secondary: (formData.get('email_secondary') as string) || null,
        phone_primary: (formData.get('phone_primary') as string) || null,
        phone_secondary: (formData.get('phone_secondary') as string) || null,
        address_street: (formData.get('address_street') as string) || null,
        address_city: (formData.get('address_city') as string) || null,
        address_state: (formData.get('address_state') as string) || null,
        address_zip: (formData.get('address_zip') as string) || null,
        member_type: (formData.get('member_type') as string) || null,
        position: (formData.get('position') as string) || null,
        position_2: (formData.get('position_2') as string) || null,
        bsa_member_id: (formData.get('bsa_member_id') as string) || null,
        is_active: formData.get('is_active') === 'on',
      })

      setIsLoading(false)

      if (result.success) {
        router.refresh()
        onSuccess()
      } else {
        setError(result.error || 'Failed to update adult')
      }
    }
  }

  // Don't render until mounted (for SSR)
  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-bold">{isCreateMode ? 'Add Adult' : 'Edit Adult'}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                name="first_name"
                required
                defaultValue={adult?.first_name || ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                name="last_name"
                required
                defaultValue={adult?.last_name || ''}
              />
            </div>
          </div>

          {/* Email - simplified for create mode */}
          {isCreateMode ? (
            <div className="space-y-2">
              <Label htmlFor="email">Email {sendInvite && '*'}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required={sendInvite}
                placeholder="member@example.com"
              />
              <p className="text-xs text-stone-500">
                {sendInvite ? 'Required to send invite' : 'Optional - can add later to send invite'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Primary Email</Label>
                {adult?.user_id ? (
                  <>
                    <Input
                      value={adult.email || ''}
                      disabled
                      className="bg-stone-50 text-stone-600"
                    />
                    <p className="text-xs text-stone-500">Linked to app account</p>
                  </>
                ) : (
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={adult?.email || ''}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email_secondary">Secondary Email</Label>
                <Input
                  id="email_secondary"
                  name="email_secondary"
                  type="email"
                  defaultValue={adult?.email_secondary || ''}
                />
              </div>
            </div>
          )}

          {/* Phone - simplified for create mode */}
          {isCreateMode ? (
            <div className="space-y-2">
              <Label htmlFor="phone_primary">Phone</Label>
              <Input
                id="phone_primary"
                name="phone_primary"
                type="tel"
                placeholder="(555) 123-4567"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone_primary">Primary Phone</Label>
                <Input
                  id="phone_primary"
                  name="phone_primary"
                  type="tel"
                  defaultValue={adult?.phone_primary || ''}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone_secondary">Secondary Phone</Label>
                <Input
                  id="phone_secondary"
                  name="phone_secondary"
                  type="tel"
                  defaultValue={adult?.phone_secondary || ''}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
          )}

          {/* Address - only in edit mode */}
          {!isCreateMode && (
            <>
              <div className="space-y-2">
                <Label htmlFor="address_street">Street Address</Label>
                <Input
                  id="address_street"
                  name="address_street"
                  defaultValue={adult?.address_street || ''}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="address_city">City</Label>
                  <Input
                    id="address_city"
                    name="address_city"
                    defaultValue={adult?.address_city || ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address_state">State</Label>
                  <Input
                    id="address_state"
                    name="address_state"
                    defaultValue={adult?.address_state || ''}
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address_zip">ZIP</Label>
                  <Input
                    id="address_zip"
                    name="address_zip"
                    defaultValue={adult?.address_zip || ''}
                    maxLength={10}
                  />
                </div>
              </div>
            </>
          )}

          {/* BSA Info */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="font-medium text-stone-900">BSA Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="member_type">Member Type</Label>
                <select
                  id="member_type"
                  name="member_type"
                  defaultValue={adult?.member_type || ''}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {MEMBER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bsa_member_id">BSA Member ID</Label>
                <Input
                  id="bsa_member_id"
                  name="bsa_member_id"
                  defaultValue={adult?.bsa_member_id || ''}
                />
              </div>
            </div>
            <div className={isCreateMode ? '' : 'grid grid-cols-2 gap-4'}>
              <div className="space-y-2">
                <Label htmlFor="position">Position</Label>
                <Input
                  id="position"
                  name="position"
                  defaultValue={adult?.position || ''}
                  placeholder="e.g., Scoutmaster"
                />
              </div>
              {!isCreateMode && (
                <div className="space-y-2">
                  <Label htmlFor="position_2">Secondary Position</Label>
                  <Input
                    id="position_2"
                    name="position_2"
                    defaultValue={adult?.position_2 || ''}
                    placeholder="e.g., Committee Member"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Active Status - only in edit mode */}
          {!isCreateMode && (
            <div className="flex items-center gap-2 pt-2">
              <input
                id="is_active"
                name="is_active"
                type="checkbox"
                defaultChecked={adult?.is_active !== false}
                className="checkbox-native"
              />
              <Label htmlFor="is_active">Active Member</Label>
            </div>
          )}

          {/* Send Invite Option - only in create mode */}
          {isCreateMode && (
            <div className="border-t pt-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  id="send_invite"
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="checkbox-native"
                />
                <Label htmlFor="send_invite">Send invite to create app account</Label>
              </div>

              {sendInvite && (
                <div className="ml-6 space-y-2">
                  <Label htmlFor="invite_role">App Role</Label>
                  <select
                    id="invite_role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-500">
                    {ROLES.find((r) => r.value === inviteRole)?.description}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Linked Scouts - only in edit mode */}
          {!isCreateMode && (
            <div className="border-t pt-4 space-y-4">
              <h3 className="font-medium text-stone-900">Linked Scouts</h3>

              {loadingScoutData ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : scouts.length === 0 ? (
                <p className="text-sm text-stone-500">No scouts in unit</p>
              ) : (
                <>
                  {/* Current linked scouts */}
                  {guardianships.length > 0 ? (
                    <div className="space-y-2">
                      {guardianships.map((g) => (
                        <div
                          key={g.id}
                          className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2"
                        >
                          <div>
                            <span className="font-medium">{g.scout_name}</span>
                            <span className="ml-2 text-sm text-stone-500 capitalize">
                              ({g.relationship || 'Guardian'})
                            </span>
                            {g.is_primary && (
                              <span className="ml-2 text-xs text-amber-600">Primary</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveGuardianship(g.id)}
                            disabled={removingGuardianship === g.id}
                            className="text-stone-400 hover:text-error disabled:opacity-50"
                            title="Remove link"
                          >
                            {removingGuardianship === g.id ? (
                              <span className="text-xs">...</span>
                            ) : (
                              <X className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-stone-500">No scouts linked</p>
                  )}

                  {/* Add new link */}
                  {availableScouts.length > 0 && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="add_scout" className="text-xs">Add Scout</Label>
                        <select
                          id="add_scout"
                          value={selectedScoutId}
                          onChange={(e) => setSelectedScoutId(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                        >
                          <option value="">Select a scout...</option>
                          {availableScouts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.first_name} {s.last_name}
                              {s.is_active === false ? ' (inactive)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-32 space-y-1">
                        <Label htmlFor="relationship" className="text-xs">Relationship</Label>
                        <select
                          id="relationship"
                          value={selectedRelationship}
                          onChange={(e) => setSelectedRelationship(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                        >
                          {RELATIONSHIPS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddGuardianship}
                        disabled={!selectedScoutId || linkingScout}
                        className="h-9"
                      >
                        {linkingScout ? '...' : <Plus className="h-4 w-4" />}
                      </Button>
                    </div>
                  )}

                  {availableScouts.length === 0 && guardianships.length > 0 && (
                    <p className="text-xs text-stone-500">All scouts in the unit are already linked</p>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-error-light p-3 text-sm text-error">
              {error}
            </div>
          )}

          {warning && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
              {warning}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading} loadingText={isCreateMode ? 'Adding...' : 'Saving...'}>
              {isCreateMode ? (sendInvite ? 'Add & Send Invite' : 'Add Adult') : 'Update Adult'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )

  // Use portal to render modal at document body level
  // This escapes any parent transforms that could affect fixed positioning
  return createPortal(modalContent, document.body)
}
