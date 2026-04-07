/**
 * Feature Flags
 *
 * Controls feature availability across the application.
 * Features can be enabled/disabled via environment variables.
 *
 * Usage:
 *   import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
 *
 *   if (isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)) {
 *     // Show advancement features
 *   }
 */

export enum FeatureFlag {
  /**
   * Scout Advancement Tracking
   * Enables rank progress tracking, merit badges, leadership positions,
   * and activity logging for Scouts BSA.
   */
  ADVANCEMENT_TRACKING = 'ADVANCEMENT_TRACKING',

  /**
   * Scoutbook Sync
   * Enables syncing data with Scoutbook via browser extension.
   */
  SCOUTBOOK_SYNC = 'SCOUTBOOK_SYNC',

  /**
   * CLI Automation
   * Shows CLI-based browser automation for Scoutbook sync.
   * Dev-only feature - hidden in production.
   */
  CLI_AUTOMATION = 'CLI_AUTOMATION',

  /**
   * Bank Integration
   * Enables Plaid-based bank account connection for viewing
   * balances and transactions. View-only, no payment processing.
   */
  BANK_INTEGRATION = 'BANK_INTEGRATION',

  /**
   * Multi-Unit Creation
   * Enables in-app creation of additional units and the unit
   * switcher UI. Hidden by default until the multi-unit page
   * refactor is complete (see plans/multi-unit-page-refactor.md).
   */
  MULTI_UNIT_CREATION = 'MULTI_UNIT_CREATION',
}

/**
 * Feature flag configuration
 * Each flag can be controlled by an environment variable
 */
const featureFlagConfig: Record<FeatureFlag, { envVar: string; defaultValue: boolean }> = {
  [FeatureFlag.ADVANCEMENT_TRACKING]: {
    envVar: 'NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING',
    defaultValue: false, // Disabled by default until fully implemented
  },
  [FeatureFlag.SCOUTBOOK_SYNC]: {
    envVar: 'NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC',
    defaultValue: true, // Already implemented
  },
  [FeatureFlag.CLI_AUTOMATION]: {
    envVar: 'NEXT_PUBLIC_FEATURE_CLI_AUTOMATION',
    defaultValue: false, // Dev-only, hidden in production
  },
  [FeatureFlag.BANK_INTEGRATION]: {
    envVar: 'NEXT_PUBLIC_FEATURE_BANK_INTEGRATION',
    defaultValue: false, // Disabled by default, enable per environment
  },
  [FeatureFlag.MULTI_UNIT_CREATION]: {
    envVar: 'NEXT_PUBLIC_FEATURE_MULTI_UNIT_CREATION',
    defaultValue: false, // Disabled until page refactor is complete
  },
}

/**
 * Read the env var for a flag using LITERAL access.
 *
 * IMPORTANT: Next.js statically replaces `process.env.NEXT_PUBLIC_*` references
 * in client bundles, but ONLY when accessed with literal keys. Dynamic accesses
 * like `process.env[someVariable]` are not replaced and return undefined on the
 * client. Each branch below uses a literal key so the bundler can inline values.
 */
function readEnvValue(flag: FeatureFlag): string | undefined {
  switch (flag) {
    case FeatureFlag.ADVANCEMENT_TRACKING:
      return process.env.NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING
    case FeatureFlag.SCOUTBOOK_SYNC:
      return process.env.NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC
    case FeatureFlag.CLI_AUTOMATION:
      return process.env.NEXT_PUBLIC_FEATURE_CLI_AUTOMATION
    case FeatureFlag.BANK_INTEGRATION:
      return process.env.NEXT_PUBLIC_FEATURE_BANK_INTEGRATION
    case FeatureFlag.MULTI_UNIT_CREATION:
      return process.env.NEXT_PUBLIC_FEATURE_MULTI_UNIT_CREATION
  }
}

/**
 * Check if a feature flag is enabled
 * @param flag The feature flag to check
 * @returns true if the feature is enabled
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const envValue = readEnvValue(flag)

  if (envValue !== undefined) {
    return envValue === 'true' || envValue === '1'
  }

  return featureFlagConfig[flag].defaultValue
}

/**
 * Get all feature flags and their current status
 * Useful for debugging and admin panels
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  return Object.values(FeatureFlag).reduce(
    (acc, flag) => {
      acc[flag] = isFeatureEnabled(flag)
      return acc
    },
    {} as Record<FeatureFlag, boolean>
  )
}

/**
 * React hook for checking feature flags
 * Can be used in client components
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  return isFeatureEnabled(flag)
}
