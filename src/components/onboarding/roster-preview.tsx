'use client'

import { useState, useMemo } from 'react'
import { Users, AlertTriangle, ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ParsedScout, ParsedAdult } from '@/lib/import/bsa-roster-parser'

interface RosterPreviewProps {
  scouts: ParsedScout[]
  adults: ParsedAdult[]
  errors?: string[]
  /** If provided, enables selection mode with callback for selection changes */
  onSelectionChange?: (selection: { scouts: Set<number>; adults: Set<number> }) => void
  /** Initial selection (all selected by default) */
  initialSelection?: { scouts: Set<number>; adults: Set<number> }
  /** Whether to show selection checkboxes */
  selectable?: boolean
  className?: string
}

interface PatrolGroup {
  patrol: string
  scouts: { scout: ParsedScout; index: number }[]
}

interface RoleGroup {
  role: string
  adults: { adult: ParsedAdult; index: number }[]
}

export function RosterPreview({
  scouts,
  adults,
  errors = [],
  onSelectionChange,
  initialSelection,
  selectable = false,
  className,
}: RosterPreviewProps) {
  // Track expanded state for collapsible sections
  const [expandedPatrols, setExpandedPatrols] = useState<Set<string>>(new Set())
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set())

  // Selection state (indices of selected items)
  const [selectedScouts, setSelectedScouts] = useState<Set<number>>(
    initialSelection?.scouts ?? new Set(scouts.map((_, i) => i))
  )
  const [selectedAdults, setSelectedAdults] = useState<Set<number>>(
    initialSelection?.adults ?? new Set(adults.map((_, i) => i))
  )

  // Group scouts by patrol
  const patrolGroups = useMemo<PatrolGroup[]>(() => {
    const groups = new Map<string, { scout: ParsedScout; index: number }[]>()

    scouts.forEach((scout, index) => {
      const patrol = scout.patrol || 'Unassigned'
      if (!groups.has(patrol)) {
        groups.set(patrol, [])
      }
      groups.get(patrol)!.push({ scout, index })
    })

    // Sort patrols alphabetically, but put 'Unassigned' last
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === 'Unassigned') return 1
        if (b === 'Unassigned') return -1
        return a.localeCompare(b)
      })
      .map(([patrol, scouts]) => ({ patrol, scouts }))
  }, [scouts])

  // Group adults by their primary role/position
  const roleGroups = useMemo<RoleGroup[]>(() => {
    const groups = new Map<string, { adult: ParsedAdult; index: number }[]>()

    adults.forEach((adult, index) => {
      // Use first position or 'Adult Volunteer'
      const role = adult.positions?.[0] || 'Adult Volunteer'
      if (!groups.has(role)) {
        groups.set(role, [])
      }
      groups.get(role)!.push({ adult, index })
    })

    // Sort by role name
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, adults]) => ({ role, adults }))
  }, [adults])

  // Toggle patrol section
  const togglePatrol = (patrol: string) => {
    setExpandedPatrols(prev => {
      const next = new Set(prev)
      if (next.has(patrol)) {
        next.delete(patrol)
      } else {
        next.add(patrol)
      }
      return next
    })
  }

  // Toggle role section
  const toggleRole = (role: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev)
      if (next.has(role)) {
        next.delete(role)
      } else {
        next.add(role)
      }
      return next
    })
  }

  // Selection handlers
  const toggleScoutSelection = (index: number) => {
    if (!selectable) return
    setSelectedScouts(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      onSelectionChange?.({ scouts: next, adults: selectedAdults })
      return next
    })
  }

  const toggleAdultSelection = (index: number) => {
    if (!selectable) return
    setSelectedAdults(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      onSelectionChange?.({ scouts: selectedScouts, adults: next })
      return next
    })
  }

  const togglePatrolSelection = (patrol: PatrolGroup) => {
    if (!selectable) return
    const allSelected = patrol.scouts.every(({ index }) => selectedScouts.has(index))
    setSelectedScouts(prev => {
      const next = new Set(prev)
      patrol.scouts.forEach(({ index }) => {
        if (allSelected) {
          next.delete(index)
        } else {
          next.add(index)
        }
      })
      onSelectionChange?.({ scouts: next, adults: selectedAdults })
      return next
    })
  }

  const toggleRoleSelection = (role: RoleGroup) => {
    if (!selectable) return
    const allSelected = role.adults.every(({ index }) => selectedAdults.has(index))
    setSelectedAdults(prev => {
      const next = new Set(prev)
      role.adults.forEach(({ index }) => {
        if (allSelected) {
          next.delete(index)
        } else {
          next.add(index)
        }
      })
      onSelectionChange?.({ scouts: selectedScouts, adults: next })
      return next
    })
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Parse Errors/Warnings */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 mb-2">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Parse Warnings</span>
          </div>
          <ul className="space-y-1 text-sm text-amber-600 dark:text-amber-400">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Scouts Section */}
      <div>
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-3 flex items-center gap-2">
          <Users className="h-5 w-5 text-forest-600" />
          Scouts ({scouts.length})
        </h3>

        {patrolGroups.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400 italic">No scouts found in roster</p>
        ) : (
          <div className="space-y-2">
            {patrolGroups.map(group => {
              const isExpanded = expandedPatrols.has(group.patrol)
              const allSelected = group.scouts.every(({ index }) => selectedScouts.has(index))
              const someSelected = group.scouts.some(({ index }) => selectedScouts.has(index))

              return (
                <div
                  key={group.patrol}
                  className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden"
                >
                  {/* Patrol Header */}
                  <button
                    type="button"
                    onClick={() => togglePatrol(group.patrol)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {selectable && (
                        <div
                          role="checkbox"
                          aria-checked={allSelected}
                          onClick={(e) => { e.stopPropagation(); togglePatrolSelection(group) }}
                          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); togglePatrolSelection(group) } }}
                          tabIndex={0}
                          className={cn(
                            'h-5 w-5 rounded border flex items-center justify-center cursor-pointer transition-colors',
                            allSelected
                              ? 'bg-forest-600 border-forest-600 text-white'
                              : someSelected
                                ? 'bg-forest-100 dark:bg-forest-900/30 border-forest-400'
                                : 'border-stone-300 dark:border-stone-600'
                          )}
                        >
                          {allSelected && <Check className="h-3 w-3" />}
                          {someSelected && !allSelected && <div className="h-2 w-2 bg-forest-600 rounded-sm" />}
                        </div>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-stone-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-stone-400" />
                      )}
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {group.patrol === 'Unassigned' ? (
                          <span className="text-stone-500 dark:text-stone-400 italic">No Patrol</span>
                        ) : (
                          group.patrol
                        )}
                      </span>
                    </div>
                    <span className="text-sm text-stone-500 dark:text-stone-400">
                      {group.scouts.length} scout{group.scouts.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Scout List */}
                  {isExpanded && (
                    <div className="border-t border-stone-200 dark:border-stone-700">
                      {group.scouts.map(({ scout, index }) => (
                        <div
                          key={index}
                          className={cn(
                            'flex items-center gap-3 px-4 py-2 text-sm border-b border-stone-100 dark:border-stone-700 last:border-b-0',
                            selectable && 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-700/30'
                          )}
                          onClick={() => toggleScoutSelection(index)}
                        >
                          {selectable && (
                            <div
                              className={cn(
                                'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                                selectedScouts.has(index)
                                  ? 'bg-forest-600 border-forest-600 text-white'
                                  : 'border-stone-300 dark:border-stone-600'
                              )}
                            >
                              {selectedScouts.has(index) && <Check className="h-2.5 w-2.5" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-stone-900 dark:text-stone-100">
                              {scout.firstName} {scout.lastName}
                            </span>
                            {scout.positions.length > 0 && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-forest-100 dark:bg-forest-900/30 text-forest-700 dark:text-forest-300">
                                {scout.positions[0]}
                              </span>
                            )}
                          </div>
                          {scout.rank && (
                            <span className="text-xs text-stone-500 dark:text-stone-400">
                              {scout.rank}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Adults Section */}
      <div>
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-3 flex items-center gap-2">
          <Users className="h-5 w-5 text-stone-600" />
          Adults ({adults.length})
        </h3>

        {roleGroups.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400 italic">No adults found in roster</p>
        ) : (
          <div className="space-y-2">
            {roleGroups.map(group => {
              const isExpanded = expandedRoles.has(group.role)
              const allSelected = group.adults.every(({ index }) => selectedAdults.has(index))
              const someSelected = group.adults.some(({ index }) => selectedAdults.has(index))

              return (
                <div
                  key={group.role}
                  className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden"
                >
                  {/* Role Header */}
                  <button
                    type="button"
                    onClick={() => toggleRole(group.role)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {selectable && (
                        <div
                          role="checkbox"
                          aria-checked={allSelected}
                          onClick={(e) => { e.stopPropagation(); toggleRoleSelection(group) }}
                          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); toggleRoleSelection(group) } }}
                          tabIndex={0}
                          className={cn(
                            'h-5 w-5 rounded border flex items-center justify-center cursor-pointer transition-colors',
                            allSelected
                              ? 'bg-forest-600 border-forest-600 text-white'
                              : someSelected
                                ? 'bg-forest-100 dark:bg-forest-900/30 border-forest-400'
                                : 'border-stone-300 dark:border-stone-600'
                          )}
                        >
                          {allSelected && <Check className="h-3 w-3" />}
                          {someSelected && !allSelected && <div className="h-2 w-2 bg-forest-600 rounded-sm" />}
                        </div>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-stone-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-stone-400" />
                      )}
                      <span className="font-medium text-stone-900 dark:text-stone-100">{group.role}</span>
                    </div>
                    <span className="text-sm text-stone-500 dark:text-stone-400">
                      {group.adults.length} adult{group.adults.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Adult List */}
                  {isExpanded && (
                    <div className="border-t border-stone-200 dark:border-stone-700">
                      {group.adults.map(({ adult, index }) => (
                        <div
                          key={index}
                          className={cn(
                            'flex items-center gap-3 px-4 py-2 text-sm border-b border-stone-100 dark:border-stone-700 last:border-b-0',
                            selectable && 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-700/30'
                          )}
                          onClick={() => toggleAdultSelection(index)}
                        >
                          {selectable && (
                            <div
                              className={cn(
                                'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                                selectedAdults.has(index)
                                  ? 'bg-forest-600 border-forest-600 text-white'
                                  : 'border-stone-300 dark:border-stone-600'
                              )}
                            >
                              {selectedAdults.has(index) && <Check className="h-2.5 w-2.5" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-stone-900 dark:text-stone-100">
                              {adult.firstName} {adult.lastName}
                            </span>
                          </div>
                          {adult.email && (
                            <span className="text-xs text-stone-500 dark:text-stone-400 truncate max-w-[150px]">
                              {adult.email}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
