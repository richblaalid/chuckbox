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

import { updatePaymentNotes } from '@/app/actions/payments'

describe('updatePaymentNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await updatePaymentNotes('payment-123', 'New notes')

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

    const result = await updatePaymentNotes('payment-123', 'New notes')

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
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const result = await updatePaymentNotes('payment-123', 'New notes')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Payment not found')
  })

  it('should return error when payment is voided', async () => {
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
          single: vi.fn().mockResolvedValue({
            data: { unit_id: 'unit-1', voided_at: '2026-01-01T00:00:00Z' },
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

    const result = await updatePaymentNotes('payment-123', 'New notes')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Cannot edit voided payment')
  })

  it('should return error when user lacks permission', async () => {
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
          single: vi.fn().mockResolvedValue({
            data: { unit_id: 'unit-1', voided_at: null },
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

    const result = await updatePaymentNotes('payment-123', 'New notes')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Permission denied')
  })

  it('should successfully update notes', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    })

    let callCount = 0
    let paymentsCallCount = 0
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
        paymentsCallCount++
        if (paymentsCallCount === 1) {
          // First call: select payment
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { unit_id: 'unit-1', voided_at: null },
              error: null,
            }),
          }
        }
        // Second call: update payment notes
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
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

    const result = await updatePaymentNotes('payment-123', 'New notes')

    expect(result.success).toBe(true)
  })

  it('should return error when update fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    })

    let callCount = 0
    let paymentsCallCount = 0
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
        paymentsCallCount++
        if (paymentsCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { unit_id: 'unit-1', voided_at: null },
              error: null,
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            error: { message: 'Database error' },
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

    const result = await updatePaymentNotes('payment-123', 'New notes')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to update notes')
  })
})
