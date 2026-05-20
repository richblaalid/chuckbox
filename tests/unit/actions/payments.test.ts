import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { recordQuickPayment } from '@/app/actions/payments'

const validParams = {
  unitId: 'unit-1',
  scoutAccountId: 'account-1',
  scoutName: 'John Scout',
  amountDollars: 50,
  method: 'cash' as const,
}

function defaultChain() {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

describe('Payments Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordQuickPayment', () => {
    it('should return error when amount is zero or negative', async () => {
      const result = await recordQuickPayment({
        ...validParams,
        amountDollars: 0,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Amount must be greater than zero')
    })

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'parent' },
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Permission denied. Only admins and treasurers can record payments.'
      )
    })

    it('should return error when scout account not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'treasurer' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return defaultChain()
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Scout account not found')
    })

    it('should return error when scout belongs to different unit', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'treasurer' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'account-1',
                scouts: { unit_id: 'other-unit' },
              },
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Scout does not belong to this unit')
    })

    it('should return error when journal entry creation fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'treasurer' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'account-1',
                scouts: { unit_id: 'unit-1' },
              },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed' },
            }),
          }
        }
        return defaultChain()
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to create journal entry: Insert failed')
    })

    it('should rollback when required accounts not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      const deleteEq = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'treasurer' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'account-1', scouts: { unit_id: 'unit-1' } },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'journal-1' },
              error: null,
            }),
          }
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return defaultChain()
      })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Required accounts not found. Please check unit setup.'
      )
    })

    it('should record payment successfully with double-entry accounting', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'treasurer' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'account-1',
                scouts: { unit_id: 'unit-1' },
                billing_balance: 0,
              },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'journal-1' },
              error: null,
            }),
          }
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: 'bank-1', code: '1000' },
                { id: 'recv-1', code: '1200' },
              ],
              error: null,
            }),
          }
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'payments') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'payment-1' },
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(true)
      expect(result.paymentId).toBe('payment-1')
    })

    it('should leave billing_balance credit as-is (no auto-transfer) when payment produces overpayment', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'account-1',
                scouts: { unit_id: 'unit-1' },
                billing_balance: 25,
              },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'journal-1' },
              error: null,
            }),
          }
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: 'bank-1', code: '1000' },
                { id: 'recv-1', code: '1200' },
              ],
              error: null,
            }),
          }
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'payments') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'payment-1' },
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const result = await recordQuickPayment(validParams)
      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'auto_transfer_overpayment',
        expect.anything()
      )
    })
  })
})
