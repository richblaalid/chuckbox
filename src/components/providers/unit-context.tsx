'use client'

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface UnitInfo {
  id: string
  name: string
  unit_number: string
  unit_type: string
  logo_url?: string | null
}

export interface UnitMembership {
  role: string
  unit_id: string
  units: UnitInfo | null
}

export interface UnitGroup {
  id: string
  name: string
  base_unit_number: string | null
  units: UnitInfo[]
}

interface UnitContextValue {
  // Current selected unit
  currentUnit: UnitInfo | null
  currentRole: string | null

  // All accessible units
  units: UnitInfo[]
  memberships: UnitMembership[]

  // Linked unit group (if current unit is linked) - legacy support
  linkedGroup: UnitGroup | null
  linkedUnits: UnitInfo[]

  // View mode for linked units - legacy support
  combinedView: boolean
  setCombinedView: (combined: boolean) => void

  // Switch to a different unit - legacy support
  switchUnit: (unitId: string) => void
}

const UnitContext = createContext<UnitContextValue | null>(null)

export function useUnit() {
  const context = useContext(UnitContext)
  if (!context) {
    throw new Error('useUnit must be used within a UnitProvider')
  }
  return context
}

interface UnitProviderProps {
  children: ReactNode
  memberships: UnitMembership[]
  groupMemberships?: {
    role: string
    unit_groups: UnitGroup | null
  }[]
  initialUnitId?: string
}

export function UnitProvider({
  children,
  memberships,
  groupMemberships = [],
  initialUnitId
}: UnitProviderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Build list of all accessible units (memoized to prevent re-renders)
  const allUnits = useMemo(() => {
    const units: UnitInfo[] = []
    const unitIdSet = new Set<string>()

    // Add units from direct memberships
    memberships.forEach(m => {
      if (m.units && !unitIdSet.has(m.units.id)) {
        units.push(m.units)
        unitIdSet.add(m.units.id)
      }
    })

    // Add units from group memberships
    groupMemberships.forEach(gm => {
      gm.unit_groups?.units?.forEach(unit => {
        if (!unitIdSet.has(unit.id)) {
          units.push(unit)
          unitIdSet.add(unit.id)
        }
      })
    })

    return units
  }, [memberships, groupMemberships])

  // Determine initial unit
  const urlUnitId = searchParams.get('unit')
  const storedUnitId = typeof window !== 'undefined'
    ? localStorage.getItem('chuckbox_current_unit')
    : null

  // Validate that the stored/URL unit ID exists in our accessible units
  const validUnitId = (id: string | null) => id && allUnits.some(u => u.id === id)

  const defaultUnitId =
    (urlUnitId && validUnitId(urlUnitId) ? urlUnitId : null) ||
    (storedUnitId && validUnitId(storedUnitId) ? storedUnitId : null) ||
    (initialUnitId && validUnitId(initialUnitId) ? initialUnitId : null) ||
    allUnits[0]?.id

  const [currentUnitId, setCurrentUnitId] = useState<string | null>(defaultUnitId || null)
  const [combinedView, setCombinedView] = useState(false)

  // Find current unit and its membership
  const currentUnit = allUnits.find(u => u.id === currentUnitId) || null
  const currentMembership = memberships.find(m => m.unit_id === currentUnitId)

  // Get role from direct membership
  const currentRole = currentMembership?.role || null

  // Legacy support for linked units (no longer used)
  const linkedGroup = null
  const linkedUnits = currentUnit ? [currentUnit] : []

  // Persist unit selection (localStorage for client-side, cookie for server-side)
  // and clean up invalid stored values
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('chuckbox_current_unit')
      // Clear invalid stored unit ID
      if (stored && !allUnits.some(u => u.id === stored)) {
        localStorage.removeItem('chuckbox_current_unit')
      }
      // Save current valid unit ID
      if (currentUnitId) {
        localStorage.setItem('chuckbox_current_unit', currentUnitId)
        // Cookie is read by server-side getCurrentMembership() helper as a
        // fallback when no ?unit= query param is in the URL. This preserves
        // the selected unit across navigation between dashboard pages.
        document.cookie = `chuckbox_current_unit=${currentUnitId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
      }
    }
  }, [currentUnitId, allUnits])

  const switchUnit = (unitId: string) => {
    setCurrentUnitId(unitId)
    // Update URL without full navigation
    const params = new URLSearchParams(searchParams.toString())
    params.set('unit', unitId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <UnitContext.Provider value={{
      currentUnit,
      currentRole,
      units: allUnits,
      memberships,
      linkedGroup,
      linkedUnits,
      combinedView,
      setCombinedView,
      switchUnit
    }}>
      {children}
    </UnitContext.Provider>
  )
}
