'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FadeIn } from '@/components/ui/page-transition'
import { SCOUT_RANKS } from '@/lib/constants'
import { Plus, X, Users, ChevronDown, ChevronRight } from 'lucide-react'

interface Patrol {
  id: string
  name: string
  isNew?: boolean
}

interface Scout {
  id?: string
  firstName: string
  lastName: string
  patrolId?: string
  patrolName?: string
  rank?: string
  bsaMemberId?: string
  isNew?: boolean
}

interface ManualEntryProps {
  unitId: string
  onComplete: () => Promise<void>
  onBack: () => void
  isCompleting?: boolean
}

export function ManualEntry({
  unitId,
  onComplete,
  onBack,
  isCompleting = false,
}: ManualEntryProps) {
  // State for existing and new data
  const [patrols, setPatrols] = useState<Patrol[]>([])
  const [scouts, setScouts] = useState<Scout[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state for adding new patrol
  const [showAddPatrol, setShowAddPatrol] = useState(false)
  const [newPatrolName, setNewPatrolName] = useState('')

  // Form state for adding new scout
  const [showAddScout, setShowAddScout] = useState(false)
  const [newScout, setNewScout] = useState<Scout>({
    firstName: '',
    lastName: '',
    isNew: true,
  })

  // Expandable sections
  const [patrolsExpanded, setPatrolsExpanded] = useState(true)
  const [scoutsExpanded, setScoutsExpanded] = useState(true)

  // Load existing patrols and scouts
  useEffect(() => {
    async function loadData() {
      const supabase = createClient()

      const [patrolsResult, scoutsResult] = await Promise.all([
        supabase
          .from('patrols')
          .select('id, name')
          .eq('unit_id', unitId)
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('scouts')
          .select('id, first_name, last_name, patrol_id, rank, bsa_member_id')
          .eq('unit_id', unitId)
          .eq('is_active', true)
          .order('last_name'),
      ])

      if (patrolsResult.data) {
        setPatrols(patrolsResult.data.map(p => ({ id: p.id, name: p.name })))
      }

      if (scoutsResult.data) {
        setScouts(scoutsResult.data.map(s => ({
          id: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          patrolId: s.patrol_id || undefined,
          rank: s.rank || undefined,
          bsaMemberId: s.bsa_member_id || undefined,
        })))
      }

      setIsLoading(false)
    }

    loadData()
  }, [unitId])

  const handleAddPatrol = async () => {
    if (!newPatrolName.trim()) return

    setIsSaving(true)
    setError(null)

    try {
      const supabase = createClient()

      // Get max display order
      const { data: maxOrderData } = await supabase
        .from('patrols')
        .select('display_order')
        .eq('unit_id', unitId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single()

      const nextOrder = (maxOrderData?.display_order ?? 0) + 1

      const { data, error: insertError } = await supabase
        .from('patrols')
        .insert({
          unit_id: unitId,
          name: newPatrolName.trim(),
          display_order: nextOrder,
          is_active: true,
        })
        .select('id, name')
        .single()

      if (insertError) throw insertError

      setPatrols([...patrols, { id: data.id, name: data.name, isNew: true }])
      setNewPatrolName('')
      setShowAddPatrol(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add patrol')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddScout = async () => {
    if (!newScout.firstName.trim() || !newScout.lastName.trim()) return

    setIsSaving(true)
    setError(null)

    try {
      const supabase = createClient()

      const { data, error: insertError } = await supabase
        .from('scouts')
        .insert({
          unit_id: unitId,
          first_name: newScout.firstName.trim(),
          last_name: newScout.lastName.trim(),
          patrol_id: newScout.patrolId || null,
          rank: newScout.rank || null,
          bsa_member_id: newScout.bsaMemberId?.trim() || null,
          is_active: true,
        })
        .select('id')
        .single()

      if (insertError) throw insertError

      // Create scout account
      await supabase
        .from('scout_accounts')
        .insert({
          scout_id: data.id,
          unit_id: unitId,
          billing_balance: 0,
          funds_balance: 0,
        })

      // Find patrol name if assigned
      const patrolName = newScout.patrolId
        ? patrols.find(p => p.id === newScout.patrolId)?.name
        : undefined

      setScouts([...scouts, {
        id: data.id,
        firstName: newScout.firstName.trim(),
        lastName: newScout.lastName.trim(),
        patrolId: newScout.patrolId,
        patrolName,
        rank: newScout.rank,
        bsaMemberId: newScout.bsaMemberId?.trim(),
        isNew: true,
      }])

      // Reset form
      setNewScout({
        firstName: '',
        lastName: '',
        isNew: true,
      })
      setShowAddScout(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add scout')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveScout = async (scoutId: string) => {
    const scoutToRemove = scouts.find(s => s.id === scoutId)
    if (!scoutToRemove) return

    if (!confirm(`Remove ${scoutToRemove.firstName} ${scoutToRemove.lastName}?`)) {
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const supabase = createClient()

      // Soft delete by setting is_active to false
      const { error: updateError } = await supabase
        .from('scouts')
        .update({ is_active: false })
        .eq('id', scoutId)

      if (updateError) throw updateError

      setScouts(scouts.filter(s => s.id !== scoutId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove scout')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-stone-500 dark:text-stone-400">Loading...</div>
      </div>
    )
  }

  return (
    <FadeIn className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-forest-800 dark:text-forest-200 mb-2">
          Add Your Roster
        </h2>
        <p className="text-stone-600 dark:text-stone-300">
          Add scouts and patrols manually. You can always add more later from the Roster page.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-error-light dark:bg-error/10 border border-error/20 p-4">
          <p className="text-sm text-error-dark dark:text-error">{error}</p>
        </div>
      )}

      {/* Patrols Section */}
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setPatrolsExpanded(!patrolsExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-stone-50 dark:hover:bg-stone-700/50"
        >
          <div className="flex items-center gap-2">
            {patrolsExpanded ? (
              <ChevronDown className="h-5 w-5 text-stone-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-stone-400" />
            )}
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Patrols</h3>
            <span className="text-sm text-stone-500 dark:text-stone-400">({patrols.length})</span>
          </div>
        </button>

        {patrolsExpanded && (
          <div className="border-t border-stone-200 dark:border-stone-700 p-4 space-y-3">
            {patrols.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {patrols.map(patrol => (
                  <span
                    key={patrol.id}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${
                      patrol.isNew
                        ? 'bg-forest-100 dark:bg-forest-900/30 text-forest-700 dark:text-forest-300'
                        : 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    {patrol.name}
                    {patrol.isNew && (
                      <span className="ml-1 text-xs text-forest-500">new</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {showAddPatrol ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newPatrolName}
                  onChange={(e) => setNewPatrolName(e.target.value)}
                  placeholder="Patrol name"
                  className="flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddPatrol()
                    }
                    if (e.key === 'Escape') {
                      setShowAddPatrol(false)
                      setNewPatrolName('')
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleAddPatrol}
                  disabled={!newPatrolName.trim() || isSaving}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddPatrol(false)
                    setNewPatrolName('')
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddPatrol(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Patrol
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Scouts Section */}
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setScoutsExpanded(!scoutsExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-stone-50 dark:hover:bg-stone-700/50"
        >
          <div className="flex items-center gap-2">
            {scoutsExpanded ? (
              <ChevronDown className="h-5 w-5 text-stone-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-stone-400" />
            )}
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Scouts</h3>
            <span className="text-sm text-stone-500 dark:text-stone-400">({scouts.length})</span>
          </div>
        </button>

        {scoutsExpanded && (
          <div className="border-t border-stone-200 dark:border-stone-700 p-4 space-y-4">
            {scouts.length > 0 && (
              <div className="space-y-2">
                {scouts.map(scout => (
                  <div
                    key={scout.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      scout.isNew
                        ? 'border-forest-200 dark:border-forest-800 bg-forest-50 dark:bg-forest-900/10'
                        : 'border-stone-200 dark:border-stone-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-stone-400" />
                      <div>
                        <p className="font-medium text-stone-900 dark:text-stone-100">
                          {scout.firstName} {scout.lastName}
                          {scout.isNew && (
                            <span className="ml-2 text-xs text-forest-600 dark:text-forest-400">new</span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                          {scout.patrolName || patrols.find(p => p.id === scout.patrolId)?.name || 'No patrol'}
                          {scout.rank && (
                            <>
                              <span>·</span>
                              <span>{scout.rank}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => scout.id && handleRemoveScout(scout.id)}
                      className="text-stone-400 hover:text-error p-1"
                      disabled={isSaving}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddScout ? (
              <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="first_name" className="text-sm">First Name *</Label>
                    <Input
                      id="first_name"
                      value={newScout.firstName}
                      onChange={(e) => setNewScout({ ...newScout, firstName: e.target.value })}
                      placeholder="First name"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="last_name" className="text-sm">Last Name *</Label>
                    <Input
                      id="last_name"
                      value={newScout.lastName}
                      onChange={(e) => setNewScout({ ...newScout, lastName: e.target.value })}
                      placeholder="Last name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="patrol" className="text-sm">Patrol</Label>
                    <select
                      id="patrol"
                      value={newScout.patrolId || ''}
                      onChange={(e) => setNewScout({ ...newScout, patrolId: e.target.value || undefined })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">No patrol</option>
                      {patrols.map(patrol => (
                        <option key={patrol.id} value={patrol.id}>
                          {patrol.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rank" className="text-sm">Rank</Label>
                    <select
                      id="rank"
                      value={newScout.rank || ''}
                      onChange={(e) => setNewScout({ ...newScout, rank: e.target.value || undefined })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Select rank...</option>
                      {SCOUT_RANKS.map(rank => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bsa_id" className="text-sm">BSA Member ID (optional)</Label>
                  <Input
                    id="bsa_id"
                    value={newScout.bsaMemberId || ''}
                    onChange={(e) => setNewScout({ ...newScout, bsaMemberId: e.target.value })}
                    placeholder="Optional"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddScout(false)
                      setNewScout({ firstName: '', lastName: '', isNew: true })
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddScout}
                    disabled={!newScout.firstName.trim() || !newScout.lastName.trim() || isSaving}
                  >
                    Add Scout
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddScout(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Scout
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer with navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack} disabled={isSaving || isCompleting}>
          Back
        </Button>
        <div className="flex items-center gap-4">
          {scouts.length === 0 && (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              You can add scouts later
            </p>
          )}
          <Button onClick={onComplete} disabled={isSaving || isCompleting}>
            {isCompleting ? 'Completing...' : scouts.length > 0 ? 'Complete Setup' : 'Skip for Now'}
          </Button>
        </div>
      </div>
    </FadeIn>
  )
}
