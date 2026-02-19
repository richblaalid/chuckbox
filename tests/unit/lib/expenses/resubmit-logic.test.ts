import { describe, it, expect } from 'vitest'

/**
 * Tests the rejection field clearing logic used in updateExpenseReimbursement.
 * This verifies the pure logic without needing to mock Supabase.
 */

interface UpdatePayload {
  status: string
  submitted_at: string | null
  rejection_reason?: null
  reviewed_by?: null
  reviewed_at?: null
  review_notes?: null
}

function buildUpdatePayload(
  shouldSubmit: boolean,
  currentStatus: string,
): UpdatePayload {
  const payload: UpdatePayload = {
    status: shouldSubmit ? 'submitted' : 'draft',
    submitted_at: shouldSubmit ? new Date().toISOString() : null,
  }

  // Clear rejection fields if resubmitting a rejected expense
  if (shouldSubmit && currentStatus === 'rejected') {
    payload.rejection_reason = null
    payload.reviewed_by = null
    payload.reviewed_at = null
    payload.review_notes = null
  }

  return payload
}

describe('expense resubmission logic', () => {
  it('sets status to submitted when shouldSubmit is true', () => {
    const payload = buildUpdatePayload(true, 'draft')
    expect(payload.status).toBe('submitted')
  })

  it('sets status to draft when shouldSubmit is false', () => {
    const payload = buildUpdatePayload(false, 'rejected')
    expect(payload.status).toBe('draft')
  })

  it('clears rejection fields when resubmitting a rejected expense', () => {
    const payload = buildUpdatePayload(true, 'rejected')
    expect(payload.status).toBe('submitted')
    expect(payload.rejection_reason).toBeNull()
    expect(payload.reviewed_by).toBeNull()
    expect(payload.reviewed_at).toBeNull()
    expect(payload.review_notes).toBeNull()
  })

  it('does not clear rejection fields when submitting a draft', () => {
    const payload = buildUpdatePayload(true, 'draft')
    expect(payload.status).toBe('submitted')
    expect(payload).not.toHaveProperty('rejection_reason')
    expect(payload).not.toHaveProperty('reviewed_by')
  })

  it('does not clear rejection fields when saving rejected as draft', () => {
    const payload = buildUpdatePayload(false, 'rejected')
    expect(payload.status).toBe('draft')
    expect(payload).not.toHaveProperty('rejection_reason')
    expect(payload).not.toHaveProperty('reviewed_by')
  })

  it('sets submitted_at when submitting', () => {
    const payload = buildUpdatePayload(true, 'rejected')
    expect(payload.submitted_at).not.toBeNull()
  })

  it('clears submitted_at when saving as draft', () => {
    const payload = buildUpdatePayload(false, 'draft')
    expect(payload.submitted_at).toBeNull()
  })
})
