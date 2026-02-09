/**
 * Unit tests for feature-flags.ts
 * Tests feature flag configuration and environment variable handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FeatureFlag,
  isFeatureEnabled,
  getAllFeatureFlags,
  useFeatureFlag,
} from '@/lib/feature-flags'

describe('feature-flags', () => {
  // Store original env values
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset environment variables before each test
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
  })

  describe('FeatureFlag enum', () => {
    it('should have ADVANCEMENT_TRACKING flag', () => {
      expect(FeatureFlag.ADVANCEMENT_TRACKING).toBe('ADVANCEMENT_TRACKING')
    })

    it('should have SCOUTBOOK_SYNC flag', () => {
      expect(FeatureFlag.SCOUTBOOK_SYNC).toBe('SCOUTBOOK_SYNC')
    })

    it('should have BANK_INTEGRATION flag', () => {
      expect(FeatureFlag.BANK_INTEGRATION).toBe('BANK_INTEGRATION')
    })
  })

  describe('isFeatureEnabled', () => {
    describe('ADVANCEMENT_TRACKING flag', () => {
      it('should return false by default (no env var)', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', undefined as unknown as string)
        delete process.env.NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
      })

      it('should return true when env var is "true"', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'true')

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(true)
      })

      it('should return true when env var is "1"', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', '1')

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(true)
      })

      it('should return false when env var is "false"', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'false')

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
      })

      it('should return false when env var is "0"', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', '0')

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
      })

      it('should return false for any other string value', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'yes')

        expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
      })
    })

    describe('SCOUTBOOK_SYNC flag', () => {
      it('should return true by default (no env var)', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', undefined as unknown as string)
        delete process.env.NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC

        expect(isFeatureEnabled(FeatureFlag.SCOUTBOOK_SYNC)).toBe(true)
      })

      it('should return false when explicitly disabled', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', 'false')

        expect(isFeatureEnabled(FeatureFlag.SCOUTBOOK_SYNC)).toBe(false)
      })

      it('should return true when explicitly enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', 'true')

        expect(isFeatureEnabled(FeatureFlag.SCOUTBOOK_SYNC)).toBe(true)
      })
    })

    describe('BANK_INTEGRATION flag', () => {
      it('should return false by default (no env var)', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_BANK_INTEGRATION', undefined as unknown as string)
        delete process.env.NEXT_PUBLIC_FEATURE_BANK_INTEGRATION

        expect(isFeatureEnabled(FeatureFlag.BANK_INTEGRATION)).toBe(false)
      })

      it('should return true when explicitly enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_BANK_INTEGRATION', 'true')

        expect(isFeatureEnabled(FeatureFlag.BANK_INTEGRATION)).toBe(true)
      })

      it('should return false when explicitly disabled', () => {
        vi.stubEnv('NEXT_PUBLIC_FEATURE_BANK_INTEGRATION', 'false')

        expect(isFeatureEnabled(FeatureFlag.BANK_INTEGRATION)).toBe(false)
      })
    })
  })

  describe('getAllFeatureFlags', () => {
    it('should return all feature flags with their status', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', undefined as unknown as string)
      vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', undefined as unknown as string)
      vi.stubEnv('NEXT_PUBLIC_FEATURE_BANK_INTEGRATION', undefined as unknown as string)
      delete process.env.NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING
      delete process.env.NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC
      delete process.env.NEXT_PUBLIC_FEATURE_BANK_INTEGRATION

      const flags = getAllFeatureFlags()

      expect(flags).toHaveProperty('ADVANCEMENT_TRACKING')
      expect(flags).toHaveProperty('SCOUTBOOK_SYNC')
      expect(flags).toHaveProperty('BANK_INTEGRATION')
      // Check default values
      expect(flags.ADVANCEMENT_TRACKING).toBe(false) // Default is false
      expect(flags.SCOUTBOOK_SYNC).toBe(true) // Default is true
      expect(flags.BANK_INTEGRATION).toBe(false) // Default is false
    })

    it('should reflect environment variable overrides', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'true')
      vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', 'false')

      const flags = getAllFeatureFlags()

      expect(flags.ADVANCEMENT_TRACKING).toBe(true)
      expect(flags.SCOUTBOOK_SYNC).toBe(false)
    })

    it('should return an object with all FeatureFlag enum values as keys', () => {
      const flags = getAllFeatureFlags()
      const enumValues = Object.values(FeatureFlag)

      enumValues.forEach((flag) => {
        expect(flags).toHaveProperty(flag)
        expect(typeof flags[flag]).toBe('boolean')
      })
    })
  })

  describe('useFeatureFlag', () => {
    it('should return the same result as isFeatureEnabled', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'true')
      vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', 'false')

      expect(useFeatureFlag(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(
        isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)
      )
      expect(useFeatureFlag(FeatureFlag.SCOUTBOOK_SYNC)).toBe(
        isFeatureEnabled(FeatureFlag.SCOUTBOOK_SYNC)
      )
    })

    it('should work with default values', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', undefined as unknown as string)
      vi.stubEnv('NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC', undefined as unknown as string)
      delete process.env.NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING
      delete process.env.NEXT_PUBLIC_FEATURE_SCOUTBOOK_SYNC

      expect(useFeatureFlag(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
      expect(useFeatureFlag(FeatureFlag.SCOUTBOOK_SYNC)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string env var as false', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', '')

      // Empty string is defined but not "true" or "1", so should be false
      expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
    })

    it('should handle whitespace in env var', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', ' true ')

      // Whitespace means it's not exactly "true" or "1"
      expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
    })

    it('should be case-sensitive for "true"', () => {
      vi.stubEnv('NEXT_PUBLIC_FEATURE_ADVANCEMENT_TRACKING', 'TRUE')

      // Case matters - only "true" or "1" enable the flag
      expect(isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)).toBe(false)
    })
  })
})
