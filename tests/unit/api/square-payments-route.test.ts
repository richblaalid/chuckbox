import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentMembership: vi.fn(() =>
    Promise.resolve({ unit_id: 'unit-1', role: 'treasurer', profile_id: 'profile-1' })
  ),
  getRequestedUnitId: vi.fn(() => null),
}))

vi.mock('@/lib/square/client', () => ({
  getSquareClientForUnit: vi.fn(() =>
    Promise.resolve({
      payments: {
        create: vi.fn(() =>
          Promise.resolve({
            payment: {
              id: 'sq-pay-1',
              status: 'COMPLETED',
              receiptUrl: 'https://squareup.com/receipt/1',
              receiptNumber: 'R1',
              orderId: 'order-1',
              sourceType: 'CARD',
              createdAt: '2026-07-12T00:00:00Z',
              buyerEmailAddress: null,
              cardDetails: { card: { cardBrand: 'VISA', last4: '1111' } },
            },
          })
        ),
      },
    })
  ),
  getDefaultLocationId: vi.fn(() => Promise.resolve('loc-1')),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    square: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}))

import { POST } from '@/app/api/square/payments/route'

const SCOUT_ACCOUNT_ID = '11111111-1111-4111-a111-111111111111'

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/square/payments', {
    method: 'POST',
    body: JSON.stringify({
      scoutAccountId: SCOUT_ACCOUNT_ID,
      amountCents: 5000,
      sourceId: 'cnon:card-nonce',
    }),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/square/payments — journal line failure handling', () => {
  const journalEntryDeleteEq = vi.fn().mockResolvedValue({ error: null })
  const paymentsInsert = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    journalEntryDeleteEq.mockResolvedValue({ error: null })

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'profile-1', email: 'treasurer@example.com', full_name: 'Treasurer' },
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
              id: SCOUT_ACCOUNT_ID,
              scout_id: 'scout-1',
              unit_id: 'unit-1',
              billing_balance: -100,
              funds_balance: 0,
              scouts: { first_name: 'John', last_name: 'Scout' },
            },
            error: null,
          }),
        }
      }
      if (table === 'journal_entries') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnValue({ eq: journalEntryDeleteEq }),
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
              { id: 'fee-1', code: '5600' },
            ],
            error: null,
          }),
        }
      }
      if (table === 'journal_lines') {
        return {
          insert: vi.fn().mockResolvedValue({
            error: { message: 'insert failed', code: '23503' },
          }),
        }
      }
      if (table === 'payments') {
        return {
          insert: paymentsInsert.mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'payment-1' },
            error: null,
          }),
        }
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
    })
  })

  it('returns 500 with the Square payment id when journal lines fail to insert', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body.squarePaymentId).toBe('sq-pay-1')
    expect(body.error).toContain('failed to record')
  })

  it('deletes the orphan journal entry and records no payment when lines fail', async () => {
    await POST(makeRequest())

    expect(journalEntryDeleteEq).toHaveBeenCalledWith('id', 'journal-1')
    expect(paymentsInsert).not.toHaveBeenCalled()
  })
})
