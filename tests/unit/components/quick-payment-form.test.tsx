import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'

// Mock router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

// Mock the server action — we just assert it gets called with the right shape.
const recordQuickPaymentMock = vi.fn(async () => ({ success: true, paymentId: 'pmt-1' }))
vi.mock('@/app/actions/payments', () => ({
  recordQuickPayment: (...args: unknown[]) => recordQuickPaymentMock(...args),
}))

// Mock analytics
vi.mock('@/lib/analytics', () => ({
  trackPaymentInitiated: vi.fn(),
  trackPaymentCompleted: vi.fn(),
  trackPaymentFailed: vi.fn(),
}))

// Mock the Supabase client — returns the outstanding charges for the scout.
// The form fetches: .from('billing_charges').select(...).eq('scout_account_id', accountId).or('is_void.is.null,is_void.eq.false')
const charges = [
  { id: 'A', amount: 30, paid_amount: 0, is_paid: false, billing_records: { id: 'br-A', description: 'Camp Deposit', billing_date: '2026-06-01', created_at: '2026-06-01' } },
  { id: 'B', amount: 25, paid_amount: 0, is_paid: false, billing_records: { id: 'br-B', description: 'Popcorn', billing_date: '2026-06-15', created_at: '2026-06-15' } },
]
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => Promise.resolve({ data: charges, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: { success: true }, error: null })),
  }),
}))

const scout = {
  id: 's-1',
  first_name: 'Jane',
  last_name: 'Scout',
  scout_accounts: {
    id: 'sa-1',
    billing_balance: -55,
    funds_balance: 10,
  },
}

beforeEach(() => {
  recordQuickPaymentMock.mockClear()
})

describe('QuickPaymentForm', () => {
  it('opens with no amount pre-filled even when initialChargeId provided (Bug 2)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    // The main amount input has id="quick-amount" labelled "Amount to Collect"
    const amountInput = screen.getByLabelText(/Amount to Collect|Cash \/ Check \/ Card Amount/i) as HTMLInputElement
    expect(amountInput.value).toBe('')
  })

  it('opens with initialChargeId pre-checked in the allocation list (Bug 1)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    // Radix Checkbox renders as role="checkbox" (a button), not input[type="checkbox"].
    // The checkboxes are labelled via htmlFor on the adjacent <label>.
    // getByLabelText finds them by the associated label text.
    const popcornCheckbox = screen.getByLabelText(/Popcorn/i) as HTMLButtonElement
    expect(popcornCheckbox).toHaveAttribute('data-state', 'checked')
    const campCheckbox = screen.getByLabelText(/Camp Deposit/i) as HTMLButtonElement
    expect(campCheckbox).toHaveAttribute('data-state', 'unchecked')
  })

  it('submits with engine-computed allocations (Bug 3 + Bug 4)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    const mainAmount = screen.getByLabelText(/Amount to Collect|Cash \/ Check \/ Card Amount/i) as HTMLInputElement
    fireEvent.change(mainAmount, { target: { value: '25' } })

    // Button text includes amount: "Record $25.00"
    const submit = screen.getByRole('button', { name: /Record/i })
    fireEvent.click(submit)

    await waitFor(() => expect(recordQuickPaymentMock).toHaveBeenCalled())
    const callArgs = recordQuickPaymentMock.mock.calls[0][0] as { allocations: Array<{ chargeId: string; amount: number }> }
    expect(callArgs.allocations).toEqual([{ chargeId: 'B', amount: 25 }])
  })

  it('blocks submit when cash exceeds outstanding (no auto-transfer)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    const mainAmount = screen.getByLabelText(/Amount to Collect/i) as HTMLInputElement
    fireEvent.change(mainAmount, { target: { value: '100' } })

    const submit = screen.getByRole('button', { name: /Record/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
