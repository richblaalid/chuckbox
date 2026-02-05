/**
 * Advancement module - server actions for scout advancement tracking
 *
 * This module is being incrementally refactored. Currently re-exports from
 * the original advancement.ts file. As functions are extracted to sub-modules,
 * they will be re-exported from here.
 *
 * Sub-modules (planned):
 * - types.ts - Shared types and interfaces ✓
 * - utils.ts - Auth helpers and validation ✓
 * - rank-progress.ts - Rank advancement functions ✓
 * - merit-badges.ts - Merit badge functions ✓
 * - bulk-operations.ts - Bulk sign-off functions
 * - queries.ts - Read-only data fetching
 */

// Export shared types
export * from './types'

// Export utility functions
export * from './utils'

// Export rank progress functions
export * from './rank-progress'

// Export merit badge functions
export * from './merit-badges'

// Export bulk operations functions
export * from './bulk-operations'

// Export leadership and activity functions
export * from './leadership'

// Export query functions
export * from './queries'
