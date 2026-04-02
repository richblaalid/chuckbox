import { describe, it, expect, vi, beforeEach } from 'vitest'
import { revalidatePath } from 'next/cache'

// Mock Next.js cache functions
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Supabase client
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

// Import after mocking
import { addFundsToScout, voidPayment } from '@/app/actions/funds'

describe('Funds Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('addFundsToScout', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

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

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when scout account not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Scout account not found')
    })

    it('should return error when scout account fetch fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to find scout account')
    })

    it('should return error when user is not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'John', last_name: 'Scout' },
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins and treasurers can add funds')
    })

    it('should return error when membership check fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'John', last_name: 'Scout' },
              },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Error' },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to verify permissions')
    })

    it('should return error when amount is zero or negative', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'John', last_name: 'Scout' },
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 0, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Amount must be greater than 0')
    })

    it('should return error when fundraiser type not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'John', last_name: 'Scout' },
              },
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
        if (table === 'fundraiser_types') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid fundraiser type')
    })

    it('should successfully add funds when all conditions are met', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'John', last_name: 'Scout' },
              },
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
        if (table === 'fundraiser_types') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: 'Popcorn Sales' },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true, journal_entry_id: 'journal-123' },
        error: null,
      })

      const result = await addFundsToScout('account-123', 100, 'fundraiser-1', 'Test notes')

      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('credit_fundraising_to_scout', {
        p_scout_account_id: 'account-123',
        p_amount: 100,
        p_description: 'Popcorn Sales: Test notes - John Scout',
        p_fundraiser_type: 'Popcorn Sales',
      })
    })

    it('should use default description when no notes provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'scout_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'account-123',
                unit_id: 'unit-456',
                scout: { first_name: 'Jane', last_name: 'Doe' },
              },
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
        if (table === 'fundraiser_types') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: 'Car Wash' },
              error: null,
            }),
          }
        }
        if (table === 'journal_entries') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true, journal_entry_id: 'journal-456' },
        error: null,
      })

      await addFundsToScout('account-123', 50, 'fundraiser-1')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('credit_fundraising_to_scout', {
        p_scout_account_id: 'account-123',
        p_amount: 50,
        p_description: 'Car Wash credit - Jane Doe',
        p_fundraiser_type: 'Car Wash',
      })
    })
  })

  describe('voidPayment', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await voidPayment('payment-123', 'Test reason')

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

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when payment not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Payment not found')
    })

    it('should return error when payment has already been voided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: '2024-01-01T00:00:00Z',
                square_payment_id: null,
              },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Payment has already been voided')
    })

    it('should return error when trying to void Square payment', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: 'square-abc123',
              },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Cannot void Square payments - use Square dashboard for refunds')
    })

    it('should return error when user is not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'leader' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins and treasurers can void payments')
    })

    it('should successfully void payment when admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true, reversal_entry_id: 'reversal-123' },
        error: null,
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('void_payment', {
        p_payment_id: 'payment-123',
        p_voided_by: 'profile-123',
        p_reason: 'Test reason',
      })
    })

    it('should return error when RPC fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('RPC failed')
    })

    it('should successfully void payment when treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true, reversal_entry_id: 'reversal-456' },
        error: null,
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(true)
    })

    it('should return error when RPC returns failure result', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Payment not found' },
        error: null,
      })

      const result = await voidPayment('payment-123', 'Test reason')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Payment not found')
    })

    it('should revalidate correct finance paths after successful void', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                unit_id: 'unit-456',
                voided_at: null,
                square_payment_id: null,
              },
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true, reversal_entry_id: 'reversal-789' },
        error: null,
      })

      await voidPayment('payment-123', 'Test reason')

      expect(revalidatePath).toHaveBeenCalledWith('/finances')
      expect(revalidatePath).toHaveBeenCalledWith('/finances/payments')
      expect(revalidatePath).toHaveBeenCalledWith('/finances/accounts')
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    })
  })
})
