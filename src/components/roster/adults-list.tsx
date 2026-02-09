'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { StatusFilterButtons, type StatusFilter } from '@/components/ui/filter-buttons'
import { SearchInput } from '@/components/ui/search-input'
import { SortIcon, type SortDirection } from '@/components/ui/sort-icon'
import { InviteRosterAdultDialog } from './invite-roster-adult-dialog'
import { AdultForm } from './adult-form'
import { Button } from '@/components/ui/button'

interface RosterAdult {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email?: string | null
  email_secondary?: string | null
  phone_primary?: string | null
  phone_secondary?: string | null
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  member_type: string | null
  position: string | null
  position_2: string | null
  bsa_member_id: string | null
  renewal_status: string | null
  expiration_date: string | null
  is_active: boolean | null
  user_id: string | null  // indicates if they have an app account
}

interface AdultsListProps {
  adults: RosterAdult[]
  canManage: boolean
  unitId: string
}

type SortColumn = 'name' | 'position' | 'type' | 'status' | 'bsa_status'

export function AdultsList({ adults, canManage, unitId }: AdultsListProps) {
  const router = useRouter()
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [invitingAdult, setInvitingAdult] = useState<RosterAdult | null>(null)
  const [editingAdult, setEditingAdult] = useState<RosterAdult | null>(null)

  // Extract unique positions and types
  const positions = useMemo(() => {
    const unique = new Set<string>()
    adults.forEach((a) => {
      if (a.position) unique.add(a.position)
      if (a.position_2) unique.add(a.position_2)
    })
    return Array.from(unique).sort()
  }, [adults])

  const types = useMemo(() => {
    const unique = new Set<string>()
    adults.forEach((a) => {
      if (a.member_type) unique.add(a.member_type)
    })
    return Array.from(unique).sort()
  }, [adults])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const hasActiveFilters = selectedPositions.size > 0 || selectedTypes.size > 0 || statusFilter !== 'all'

  const clearAllFilters = () => {
    setSelectedPositions(new Set())
    setSelectedTypes(new Set())
    setStatusFilter('all')
    setSearchQuery('')
  }

  const filteredAndSortedAdults = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    let filtered = query
      ? adults.filter((adult) => {
          const fullName = `${adult.first_name || ''} ${adult.last_name || ''}`.toLowerCase()
          const reverseName = `${adult.last_name || ''} ${adult.first_name || ''}`.toLowerCase()
          return (
            fullName.includes(query) ||
            reverseName.includes(query) ||
            (adult.first_name?.toLowerCase().includes(query) ?? false) ||
            (adult.last_name?.toLowerCase().includes(query) ?? false) ||
            (adult.position?.toLowerCase().includes(query) ?? false)
          )
        })
      : adults

    if (selectedPositions.size > 0) {
      filtered = filtered.filter((adult) =>
        (adult.position && selectedPositions.has(adult.position)) ||
        (adult.position_2 && selectedPositions.has(adult.position_2))
      )
    }

    if (selectedTypes.size > 0) {
      filtered = filtered.filter((adult) => adult.member_type && selectedTypes.has(adult.member_type))
    }

    if (statusFilter === 'active') {
      filtered = filtered.filter((adult) => adult.is_active === true)
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((adult) => adult.is_active === false)
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'name':
          comparison = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
          break
        case 'position':
          comparison = (a.position || '').localeCompare(b.position || '')
          break
        case 'type':
          comparison = (a.member_type || '').localeCompare(b.member_type || '')
          break
        case 'status':
          comparison = (a.is_active === b.is_active) ? 0 : a.is_active ? -1 : 1
          break
        case 'bsa_status':
          comparison = (a.renewal_status || '').localeCompare(b.renewal_status || '')
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [adults, sortColumn, sortDirection, searchQuery, selectedPositions, selectedTypes, statusFilter])

  if (adults.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-stone-500">No adults in your roster yet.</p>
        <p className="mt-2 text-sm text-stone-400">
          Import adults from Scoutbook to see them here.
        </p>
      </div>
    )
  }

  const headerClass = "pb-3 pr-4"
  const headerButtonClass = "inline-flex items-center gap-1 cursor-pointer select-none hover:text-stone-700 transition-colors text-left font-medium"

  const getAriaSort = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sortColumn !== column) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  const formatMemberType = (type: string) => {
    if (type === 'LEADER') return 'Leader'
    if (type === 'P 18+') return 'Parent'
    return type
  }

  const getBsaStatusBadge = (renewalStatus: string | null) => {
    if (!renewalStatus) return null

    const isExpired = renewalStatus.toLowerCase().includes('expired')
    const isCurrent = renewalStatus.toLowerCase().includes('current') ||
                      renewalStatus.toLowerCase().includes('registered')

    return (
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
          isExpired
            ? 'bg-error-light text-error'
            : isCurrent
              ? 'bg-success-light text-success'
              : 'bg-stone-100 text-stone-600'
        }`}
      >
        {renewalStatus}
      </span>
    )
  }

  const getAppStatusBadge = (userId: string | null) => {
    if (userId) {
      return (
        <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-forest-100 text-forest-700">
          App User
        </span>
      )
    }
    return (
      <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-stone-100 text-stone-500">
        Not Invited
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name..."
          ariaLabel="Search adults by name"
        />

        <MultiSelectDropdown
          label="Position"
          options={positions}
          selected={selectedPositions}
          onChange={setSelectedPositions}
        />

        <MultiSelectDropdown
          label="Type"
          options={types}
          selected={selectedTypes}
          onChange={setSelectedTypes}
        />

        <StatusFilterButtons value={statusFilter} onChange={setStatusFilter} />

        {(hasActiveFilters || searchQuery) && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        )}
      </div>

      {/* Results count */}
      {(searchQuery || hasActiveFilters) && (
        <p className="text-sm text-stone-500">
          {filteredAndSortedAdults.length === 0
            ? 'No adults found'
            : `${filteredAndSortedAdults.length} of ${adults.length} adult${adults.length !== 1 ? 's' : ''}`}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-stone-500">
              <th className={headerClass} aria-sort={getAriaSort('name')}>
                <button type="button" onClick={() => handleSort('name')} className={headerButtonClass}>
                  Name
                  <SortIcon direction={sortDirection} active={sortColumn === 'name'} />
                </button>
              </th>
              <th className={`${headerClass} hidden sm:table-cell`} aria-sort={getAriaSort('position')}>
                <button type="button" onClick={() => handleSort('position')} className={headerButtonClass}>
                  Position
                  <SortIcon direction={sortDirection} active={sortColumn === 'position'} />
                </button>
              </th>
              <th className={`${headerClass} hidden md:table-cell`} aria-sort={getAriaSort('type')}>
                <button type="button" onClick={() => handleSort('type')} className={headerButtonClass}>
                  Type
                  <SortIcon direction={sortDirection} active={sortColumn === 'type'} />
                </button>
              </th>
              <th className={`${headerClass} hidden lg:table-cell`} aria-sort={getAriaSort('bsa_status')}>
                <button type="button" onClick={() => handleSort('bsa_status')} className={headerButtonClass}>
                  BSA Status
                  <SortIcon direction={sortDirection} active={sortColumn === 'bsa_status'} />
                </button>
              </th>
              <th className={`${headerClass} hidden xl:table-cell`}>
                App Status
              </th>
              {canManage && <th className="pb-3 pl-4 sm:pl-6 font-medium whitespace-nowrap">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedAdults.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="py-8 text-center text-stone-500">
                  No adults match your filters
                </td>
              </tr>
            ) : (
              filteredAndSortedAdults.map((adult) => (
                <tr key={adult.id} className="border-b last:border-0">
                  <td className="py-3 pr-4">
                    <div>
                      <Link
                        href={`/adults/${adult.id}`}
                        className="font-medium text-stone-900 hover:text-forest-600"
                      >
                        {adult.first_name} {adult.last_name}
                      </Link>
                      <p className="text-xs text-stone-500">BSA# {adult.bsa_member_id}</p>
                      {/* Show position on mobile under name */}
                      {adult.position && (
                        <p className="text-xs text-stone-500 sm:hidden">
                          {adult.position}
                          {adult.position_2 && `, ${adult.position_2}`}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="hidden py-3 pr-4 text-stone-600 sm:table-cell">
                    {adult.position ? (
                      <div>
                        <span>{adult.position}</span>
                        {adult.position_2 && (
                          <span className="block text-xs text-stone-500">{adult.position_2}</span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="hidden py-3 pr-4 text-stone-600 md:table-cell">{adult.member_type ? formatMemberType(adult.member_type) : '—'}</td>
                  <td className="hidden py-3 pr-4 lg:table-cell">
                    {getBsaStatusBadge(adult.renewal_status)}
                  </td>
                  <td className="hidden py-3 pr-4 xl:table-cell">
                    {getAppStatusBadge(adult.user_id)}
                  </td>
                  {canManage && (
                    <td className="py-3 pl-4 sm:pl-6 whitespace-nowrap">
                      <div className="flex gap-3">
                        <Link
                          href={`/adults/${adult.id}`}
                          className="text-sm text-forest-600 hover:text-forest-800 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                        >
                          View
                        </Link>
                        <button
                          className="text-sm text-forest-600 hover:text-forest-800 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2"
                          onClick={() => setEditingAdult(adult)}
                        >
                          Edit
                        </button>
                        {!adult.user_id && (
                          <button
                            className="text-sm text-stone-500 hover:text-stone-700 rounded link-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2"
                            onClick={() => setInvitingAdult(adult)}
                          >
                            Invite
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invite Dialog */}
      {invitingAdult && (
        <InviteRosterAdultDialog
          adult={invitingAdult}
          unitId={unitId}
          open={!!invitingAdult}
          onOpenChange={(open) => {
            if (!open) setInvitingAdult(null)
          }}
          onSuccess={() => {
            setInvitingAdult(null)
            router.refresh()
          }}
        />
      )}

      {/* Edit Dialog */}
      {editingAdult && (
        <AdultForm
          unitId={unitId}
          adult={{
            id: editingAdult.id,
            user_id: editingAdult.user_id,
            first_name: editingAdult.first_name,
            last_name: editingAdult.last_name,
            email: editingAdult.email || null,
            email_secondary: editingAdult.email_secondary || null,
            phone_primary: editingAdult.phone_primary || null,
            phone_secondary: editingAdult.phone_secondary || null,
            address_street: editingAdult.address_street || null,
            address_city: editingAdult.address_city || null,
            address_state: editingAdult.address_state || null,
            address_zip: editingAdult.address_zip || null,
            member_type: editingAdult.member_type,
            position: editingAdult.position,
            position_2: editingAdult.position_2,
            bsa_member_id: editingAdult.bsa_member_id,
            is_active: editingAdult.is_active,
          }}
          onClose={() => setEditingAdult(null)}
          onSuccess={() => {
            setEditingAdult(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
