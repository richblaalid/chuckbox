// Shared constants used across the application

/**
 * Month options for date selection dropdowns
 */
export const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
] as const

export type MonthValue = typeof MONTHS[number]['value']

/**
 * Scout ranks in order of progression
 */
export const SCOUT_RANKS = [
  'New Scout',
  'Scout',
  'Tenderfoot',
  'Second Class',
  'First Class',
  'Star',
  'Life',
  'Eagle',
] as const

export type ScoutRank = typeof SCOUT_RANKS[number]

/**
 * Get the numeric index of a rank (higher = more advanced)
 * Returns -1 for unknown ranks
 */
export function getRankIndex(rank: string | null | undefined): number {
  if (!rank) return -1
  const index = SCOUT_RANKS.findIndex(
    (r) => r.toLowerCase() === rank.toLowerCase()
  )
  return index
}

/**
 * Check if newRank is higher than oldRank in the progression
 * Returns true if newRank is a progression from oldRank
 * Returns false if newRank is lower, equal, or unknown
 */
export function isRankProgression(
  oldRank: string | null | undefined,
  newRank: string | null | undefined
): boolean {
  const oldIndex = getRankIndex(oldRank)
  const newIndex = getRankIndex(newRank)

  // If new rank is unknown, don't treat it as progression
  if (newIndex === -1) return false

  // If old rank is unknown, any valid new rank is acceptable
  if (oldIndex === -1) return newIndex >= 0

  // Only return true if new rank is strictly higher
  return newIndex > oldIndex
}

/**
 * Get the higher of two ranks (for merge operations)
 * Returns the rank that is further along in progression
 */
export function getHigherRank(
  rank1: string | null | undefined,
  rank2: string | null | undefined
): string | null {
  const index1 = getRankIndex(rank1)
  const index2 = getRankIndex(rank2)

  if (index1 === -1 && index2 === -1) return null
  if (index1 === -1) return rank2 || null
  if (index2 === -1) return rank1 || null

  return index1 >= index2 ? rank1! : rank2!
}

/**
 * Payment methods for manual payment entry
 */
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card (Manual Entry)' },
  { value: 'transfer', label: 'Bank Transfer' },
] as const

export type PaymentMethodValue = typeof PAYMENT_METHODS[number]['value']

/**
 * Guardian relationship types
 */
export const GUARDIAN_RELATIONSHIPS = [
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'other', label: 'Other' },
] as const

export type GuardianRelationship = typeof GUARDIAN_RELATIONSHIPS[number]['value']

/**
 * Member roles with labels and descriptions for UI
 */
export const MEMBER_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', description: 'Full access to all features' },
  { value: 'treasurer', label: 'Treasurer', description: 'Manage finances and billing' },
  { value: 'leader', label: 'Leader', description: 'Manage scouts and view reports' },
  { value: 'parent', label: 'Parent', description: 'View linked scouts only' },
] as const

/**
 * Square payment processing constants
 */
export const SQUARE = {
  FEE_PERCENT: 0.026,       // 2.6%
  FEE_FIXED_CENTS: 10,      // $0.10
  MIN_PAYMENT_CENTS: 100,   // $1.00 minimum
  MAX_PAYMENT_CENTS: 10000000, // $100,000 maximum
} as const

/**
 * Parse date string into year, month, day parts
 */
export function parseDateParts(dateStr: string | null | undefined): {
  year: string
  month: string
  day: string
} {
  if (!dateStr) return { year: '', month: '', day: '' }
  const [year, month, day] = dateStr.split('-')
  return { year: year || '', month: month || '', day: day || '' }
}

/**
 * Format date parts back into ISO date string
 */
export function formatDateParts(year: string, month: string, day: string): string | null {
  if (!year || !month || !day) return null
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Generate array of years for date picker (100 years back from current year)
 */
export function getYearOptions(yearsBack = 100): number[] {
  const currentYear = new Date().getFullYear()
  return Array.from({ length: yearsBack }, (_, i) => currentYear - i)
}

/**
 * Generate array of days for a given month (1-28/29/30/31)
 */
export function getDaysInMonth(month: string, year: string): number[] {
  if (!month || !year) return Array.from({ length: 31 }, (_, i) => i + 1)
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => i + 1)
}
