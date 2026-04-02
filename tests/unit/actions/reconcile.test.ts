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

import { reconcileSquareTransaction } from '@/app/actions/reconcile'

const scoutParams = {
  type: 'scout' as const,
  squareTransactionId: 'sq-txn-1',
  unitId: 'unit-1',
  scoutAccountId: 'account-1',
  scoutName: 'John Scout',
  amount: 50,
  feeAmount: 1.5,
  netAmount: 48.5,
  squarePaymentId: 'sq-pay-1',
  squareCreatedAt: '2026-01-15T12:00:00Z',
  receiptUrl: 'https://squareup.com/receipt/123',
}

const notScoutParams = {
  type: 'not_scout' as const,
  squareTransactionId: 'sq-txn-1',
  unitId: 'unit-1',
  amount: 50,
  feeAmount: 1.5,
  netAmount: 48.5,
  squarePaymentId: 'sq-pay-1',
  squareCreatedAt: '2026-01-15T12:00:00Z',
  receiptUrl: null,
  notes: 'Donation',
}

function defaultChain() {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

describe('reconcileSquareTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Auth & Permission Tests ---

  it('should return error when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await reconcileSquareTransaction(scoutParams)
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

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Profile not found')
  })

  it('should return error when user lacks permission', async () => {
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
            data: { role: 'leader' },
            error: null,
          }),
        }
      }
      return defaultChain()
    })

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Permission denied')
  })

  it('should return error when Square transaction not found', async () => {
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
      if (table === 'square_transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return defaultChain()
    })

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Square transaction not found')
  })

  it('should return error when transaction already reconciled', async () => {
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
      if (table === 'square_transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'sq-txn-1', payment_id: 'already-linked' },
            error: null,
          }),
        }
      }
      return defaultChain()
    })

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Transaction already reconciled')
  })

  // --- Scout Reconciliation Tests ---

  it('should reconcile Square transaction to scout account', async () => {
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
      if (table === 'square_transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'sq-txn-1', payment_id: null },
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
      if (table === 'scout_accounts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { billing_balance: 0 },
            error: null,
          }),
        }
      }
      return defaultChain()
    })

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(true)
    expect(result.paymentId).toBe('payment-1')
  })

  it('should return error when required accounts not found', async () => {
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
      if (table === 'square_transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'sq-txn-1', payment_id: null },
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

    const result = await reconcileSquareTransaction(scoutParams)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Required accounts not found (1000, 1200)')
  })

  // --- Not-Scout Reconciliation Tests ---

  it('should reconcile as not scout-related', async () => {
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
      if (table === 'square_transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'sq-txn-1', payment_id: null },
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
              { id: 'income-1', code: '4900' },
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
            data: { id: 'payment-2' },
            error: null,
          }),
        }
      }
      return defaultChain()
    })

    const result = await reconcileSquareTransaction(notScoutParams)
    expect(result.success).toBe(true)
    expect(result.paymentId).toBe('payment-2')
  })
})
