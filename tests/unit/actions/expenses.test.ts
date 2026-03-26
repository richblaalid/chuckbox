import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Next.js cache functions
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock email notifications
vi.mock('@/lib/email/send-expense-notifications', () => ({
  sendExpenseApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendExpenseRejectionEmail: vi.fn().mockResolvedValue(undefined),
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
import {
  createExpenseReimbursement,
  updateExpenseReimbursement,
  submitExpenseReimbursement,
  deleteExpenseReimbursement,
  getExpenseReimbursements,
  getExpenseReimbursement,
  approveExpenseReimbursement,
  rejectExpenseReimbursement,
  markExpensePaid,
} from '@/app/actions/expenses'

const validExpenseData = {
  description: 'Camping supplies',
  amount: 45.99,
  expense_date: '2026-02-15',
  category: 'supplies' as const,
  vendor: 'REI',
}

/** Helper: set up auth + profile + membership chain */
function setupAuthenticatedUser(
  role: string,
  overrides?: { profileId?: string; userId?: string }
) {
  const userId = overrides?.userId ?? 'user-123'
  const profileId = overrides?.profileId ?? 'profile-123'

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
  })

  return { userId, profileId, role }
}

/** Helper: create a mock chain for `from(table)` calls with table-based routing */
function mockFromChain(
  tableHandlers: Record<
    string,
    (callIndex: number) => Record<string, unknown>
  >
) {
  const tableCalls: Record<string, number> = {}

  mockSupabase.from.mockImplementation((table: string) => {
    tableCalls[table] = (tableCalls[table] ?? 0) + 1
    const handler = tableHandlers[table]
    if (handler) return handler(tableCalls[table])
    return defaultChain()
  })
}

function defaultChain() {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

function chainWithSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe('Expense Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── createExpenseReimbursement ───────────────────────────────────

  describe('createExpenseReimbursement', () => {
    it('should return error for invalid input', async () => {
      const result = await createExpenseReimbursement('unit-1', {
        description: '',
        amount: -5,
        expense_date: 'not-a-date',
        category: 'supplies',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await createExpenseReimbursement('unit-1', validExpenseData)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when profile not found', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle(null),
      })

      const result = await createExpenseReimbursement('unit-1', validExpenseData)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when not a unit member', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle(null),
      })

      const result = await createExpenseReimbursement('unit-1', validExpenseData)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should create a draft expense successfully', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
        expense_reimbursements: () =>
          chainWithSingle({ id: 'expense-1', status: 'draft' }),
      })

      const result = await createExpenseReimbursement('unit-1', {
        ...validExpenseData,
        submit: false,
      })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: 'expense-1', status: 'draft' })
    })

    it('should create and submit expense when submit=true', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
        expense_reimbursements: () =>
          chainWithSingle({ id: 'expense-1', status: 'submitted' }),
      })

      const result = await createExpenseReimbursement('unit-1', {
        ...validExpenseData,
        submit: true,
      })
      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('submitted')
    })

    it('should return error when insert fails', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
        expense_reimbursements: () =>
          chainWithSingle(null, { message: 'DB error' }),
      })

      const result = await createExpenseReimbursement('unit-1', validExpenseData)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to create expense')
    })
  })

  // ─── updateExpenseReimbursement ───────────────────────────────────

  describe('updateExpenseReimbursement', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when expense not found', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => chainWithSingle(null),
      })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Expense not found')
    })

    it('should return error when not the submitter', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'other-profile',
            status: 'draft',
            unit_id: 'unit-1',
          }),
      })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('You can only edit your own expenses')
    })

    it('should return error when expense is submitted', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'profile-123',
            status: 'submitted',
            unit_id: 'unit-1',
          }),
      })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Can only edit draft or rejected expenses')
    })

    it('should allow editing a draft expense', async () => {
      setupAuthenticatedUser('leader')
      let callCount = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          callCount++
          if (callCount === 1) {
            // fetch
            return chainWithSingle({
              id: 'expense-1',
              submitter_id: 'profile-123',
              status: 'draft',
              unit_id: 'unit-1',
            })
          }
          // update
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
      })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(true)
    })

    it('should allow editing a rejected expense', async () => {
      setupAuthenticatedUser('leader')
      let callCount = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          callCount++
          if (callCount === 1) {
            return chainWithSingle({
              id: 'expense-1',
              submitter_id: 'profile-123',
              status: 'rejected',
              unit_id: 'unit-1',
            })
          }
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
      })

      const result = await updateExpenseReimbursement(
        'expense-1',
        validExpenseData
      )
      expect(result.success).toBe(true)
    })
  })

  // ─── submitExpenseReimbursement ───────────────────────────────────

  describe('submitExpenseReimbursement', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await submitExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not the submitter', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'other-profile',
            status: 'draft',
          }),
      })

      const result = await submitExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('You can only submit your own expenses')
    })

    it('should return error when expense is not draft', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'profile-123',
            status: 'submitted',
          }),
      })

      const result = await submitExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only draft expenses can be submitted')
    })

    it('should submit a draft expense successfully', async () => {
      setupAuthenticatedUser('leader')
      let callCount = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          callCount++
          if (callCount === 1) {
            return chainWithSingle({
              id: 'expense-1',
              submitter_id: 'profile-123',
              status: 'draft',
            })
          }
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
      })

      const result = await submitExpenseReimbursement('expense-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── deleteExpenseReimbursement ───────────────────────────────────

  describe('deleteExpenseReimbursement', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await deleteExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when non-submitter non-admin tries to delete', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'other-profile',
            status: 'draft',
            unit_id: 'unit-1',
            receipt_url: null,
          }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await deleteExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Cannot delete this expense')
    })

    it('should return error when non-admin deletes non-draft expense', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'profile-123',
            status: 'submitted',
            unit_id: 'unit-1',
            receipt_url: null,
          }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await deleteExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only draft expenses can be deleted')
    })

    it('should allow submitter to delete draft expense', async () => {
      setupAuthenticatedUser('leader')
      let expenseCalls = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          expenseCalls++
          if (expenseCalls === 1) {
            return chainWithSingle({
              id: 'expense-1',
              submitter_id: 'profile-123',
              status: 'draft',
              unit_id: 'unit-1',
              receipt_url: null,
            })
          }
          // delete call
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await deleteExpenseReimbursement('expense-1')
      expect(result.success).toBe(true)
    })

    it('should allow admin to delete non-draft expense', async () => {
      setupAuthenticatedUser('admin')
      let expenseCalls = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          expenseCalls++
          if (expenseCalls === 1) {
            return chainWithSingle({
              id: 'expense-1',
              submitter_id: 'other-profile',
              status: 'submitted',
              unit_id: 'unit-1',
              receipt_url: null,
            })
          }
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
        unit_memberships: () => chainWithSingle({ role: 'admin' }),
      })

      const result = await deleteExpenseReimbursement('expense-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── getExpenseReimbursements ─────────────────────────────────────

  describe('getExpenseReimbursements', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await getExpenseReimbursements('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not a unit member', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle(null),
      })

      const result = await getExpenseReimbursements('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should return expenses for financial role', async () => {
      setupAuthenticatedUser('treasurer')
      const mockExpenses = [
        { id: 'e1', description: 'Supplies', amount: 50 },
      ]

      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
        expense_reimbursements: () => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({
            data: mockExpenses,
            error: null,
            count: 1,
          }),
        }),
      })

      const result = await getExpenseReimbursements('unit-1')
      expect(result.success).toBe(true)
      expect(result.data?.expenses).toHaveLength(1)
      expect(result.data?.total).toBe(1)
    })
  })

  // ─── getExpenseReimbursement ──────────────────────────────────────

  describe('getExpenseReimbursement', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await getExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not authorized', async () => {
      setupAuthenticatedUser('parent')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'other-profile',
            unit_id: 'unit-1',
          }),
        unit_memberships: () => chainWithSingle({ role: 'parent' }),
      })

      const result = await getExpenseReimbursement('expense-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authorized to view this expense')
    })

    it('should allow submitter to view their own expense', async () => {
      setupAuthenticatedUser('parent')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'profile-123',
            unit_id: 'unit-1',
          }),
        unit_memberships: () => chainWithSingle({ role: 'parent' }),
      })

      const result = await getExpenseReimbursement('expense-1')
      expect(result.success).toBe(true)
    })

    it('should allow treasurer to view any expense', async () => {
      setupAuthenticatedUser('treasurer')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: 'expense-1',
            submitter_id: 'other-profile',
            unit_id: 'unit-1',
          }),
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await getExpenseReimbursement('expense-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── approveExpenseReimbursement ──────────────────────────────────

  describe('approveExpenseReimbursement', () => {
    const validApproval = {
      expense_id: '550e8400-e29b-41d4-a716-446655440000',
      review_notes: 'Looks good',
    }

    it('should return error for invalid input', async () => {
      const result = await approveExpenseReimbursement({
        expense_id: 'not-a-uuid',
      })
      expect(result.success).toBe(false)
    })

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await approveExpenseReimbursement(validApproval)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not financial role', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validApproval.expense_id,
            status: 'submitted',
            unit_id: 'unit-1',
            description: 'Supplies',
            amount: 45.99,
            expense_date: '2026-02-15',
            submitter: {
              id: 'sub-1',
              full_name: 'Scout Parent',
              email: 'parent@test.com',
            },
            unit: { name: 'Troop 42' },
          }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await approveExpenseReimbursement(validApproval)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can approve expenses'
      )
    })

    it('should return error when expense is not submitted', async () => {
      setupAuthenticatedUser('treasurer')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validApproval.expense_id,
            status: 'draft',
            unit_id: 'unit-1',
            description: 'Supplies',
            amount: 45.99,
            expense_date: '2026-02-15',
            submitter: null,
            unit: null,
          }),
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await approveExpenseReimbursement(validApproval)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only submitted expenses can be approved')
    })

    it('should approve a submitted expense and create journal entry', async () => {
      setupAuthenticatedUser('treasurer')
      let expenseCalls = 0
      mockFromChain({
        profiles: (callIndex) => {
          if (callIndex <= 1)
            return chainWithSingle({ id: 'profile-123' })
          // reviewer profile lookup
          return chainWithSingle({ full_name: 'Treasurer User' })
        },
        expense_reimbursements: () => {
          expenseCalls++
          if (expenseCalls === 1) {
            return chainWithSingle({
              id: validApproval.expense_id,
              status: 'submitted',
              unit_id: 'unit-1',
              description: 'Supplies',
              amount: 45.99,
              expense_date: '2026-02-15',
              submitter: {
                id: 'sub-1',
                full_name: 'Scout Parent',
                email: 'parent@test.com',
              },
              unit: { name: 'Troop 42' },
            })
          }
          // update call
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      })

      const result = await approveExpenseReimbursement(validApproval)
      expect(result.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'create_expense_journal_entry',
        { p_expense_id: validApproval.expense_id }
      )
    })
  })

  // ─── rejectExpenseReimbursement ───────────────────────────────────

  describe('rejectExpenseReimbursement', () => {
    const validRejection = {
      expense_id: '550e8400-e29b-41d4-a716-446655440000',
      rejection_reason: 'Missing receipt documentation',
    }

    it('should return error for invalid input', async () => {
      const result = await rejectExpenseReimbursement({
        expense_id: 'not-a-uuid',
        rejection_reason: 'No',
      })
      expect(result.success).toBe(false)
    })

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await rejectExpenseReimbursement(validRejection)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not financial role', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validRejection.expense_id,
            status: 'submitted',
            unit_id: 'unit-1',
            description: 'Supplies',
            amount: 45.99,
            expense_date: '2026-02-15',
            submitter: null,
            unit: null,
          }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await rejectExpenseReimbursement(validRejection)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can reject expenses'
      )
    })

    it('should return error when expense is not submitted', async () => {
      setupAuthenticatedUser('treasurer')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validRejection.expense_id,
            status: 'approved',
            unit_id: 'unit-1',
            description: 'Supplies',
            amount: 45.99,
            expense_date: '2026-02-15',
            submitter: null,
            unit: null,
          }),
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await rejectExpenseReimbursement(validRejection)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only submitted expenses can be rejected')
    })

    it('should reject a submitted expense successfully', async () => {
      setupAuthenticatedUser('treasurer')
      let expenseCalls = 0
      mockFromChain({
        profiles: (callIndex) => {
          if (callIndex <= 1)
            return chainWithSingle({ id: 'profile-123' })
          return chainWithSingle({ full_name: 'Treasurer User' })
        },
        expense_reimbursements: () => {
          expenseCalls++
          if (expenseCalls === 1) {
            return chainWithSingle({
              id: validRejection.expense_id,
              status: 'submitted',
              unit_id: 'unit-1',
              description: 'Supplies',
              amount: 45.99,
              expense_date: '2026-02-15',
              submitter: {
                id: 'sub-1',
                full_name: 'Scout Parent',
                email: 'parent@test.com',
              },
              unit: { name: 'Troop 42' },
            })
          }
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await rejectExpenseReimbursement(validRejection)
      expect(result.success).toBe(true)
    })
  })

  // ─── markExpensePaid ──────────────────────────────────────────────

  describe('markExpensePaid', () => {
    const validPayment = {
      expense_id: '550e8400-e29b-41d4-a716-446655440000',
      payment_method: 'check',
      payment_reference: 'CHK-1234',
    }

    it('should return error for invalid input', async () => {
      const result = await markExpensePaid({
        expense_id: 'not-a-uuid',
        payment_method: '',
      })
      expect(result.success).toBe(false)
    })

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await markExpensePaid(validPayment)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not financial role', async () => {
      setupAuthenticatedUser('leader')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validPayment.expense_id,
            status: 'approved',
            unit_id: 'unit-1',
          }),
        unit_memberships: () => chainWithSingle({ role: 'leader' }),
      })

      const result = await markExpensePaid(validPayment)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can mark expenses as paid'
      )
    })

    it('should return error when expense is not approved', async () => {
      setupAuthenticatedUser('treasurer')
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () =>
          chainWithSingle({
            id: validPayment.expense_id,
            status: 'submitted',
            unit_id: 'unit-1',
          }),
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await markExpensePaid(validPayment)
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only approved expenses can be marked as paid'
      )
    })

    it('should mark an approved expense as paid', async () => {
      setupAuthenticatedUser('treasurer')
      let expenseCalls = 0
      mockFromChain({
        profiles: () => chainWithSingle({ id: 'profile-123' }),
        expense_reimbursements: () => {
          expenseCalls++
          if (expenseCalls === 1) {
            return chainWithSingle({
              id: validPayment.expense_id,
              status: 'approved',
              unit_id: 'unit-1',
            })
          }
          return {
            ...defaultChain(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        },
        unit_memberships: () => chainWithSingle({ role: 'treasurer' }),
      })

      const result = await markExpensePaid(validPayment)
      expect(result.success).toBe(true)
    })
  })
})
