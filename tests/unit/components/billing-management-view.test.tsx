import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent, within } from '@testing-library/react'
import { BillingManagementView, type BillingRecordEntry } from '@/components/billing/billing-management-view'

vi.mock('@/app/actions/billing', () => ({
  voidBillingRecord: vi.fn(),
}))

const scout = (i: number, first: string, last: string) => ({
  id: `s${i}`,
  first_name: first,
  last_name: last,
  is_active: true,
  scout_accounts: { id: `acct${i}`, billing_balance: 0, funds_balance: 0 },
  patrols: null,
})

const charge = (overrides: Partial<BillingRecordEntry['charges'][number]>): BillingRecordEntry['charges'][number] => ({
  id: 'c1',
  amount: 50,
  paid_amount: 0,
  is_paid: false,
  is_void: false,
  scout_account_id: 'acct1',
  scout_first_name: 'Jane',
  scout_last_name: 'Smith',
  payment_method: null,
  check_ref: null,
  ...overrides,
})

const recordWithMixed: BillingRecordEntry = {
  id: 'r1',
  description: 'Summer Camp Deposit',
  billing_date: '2026-05-08',
  created_at: '2026-05-08T00:00:00Z',
  total_amount: 200,
  is_void: false,
  batch_id: null,
  charges: [
    charge({ id: 'c1', is_paid: true, paid_amount: 50, scout_first_name: 'John', scout_last_name: 'Doe' }),
    charge({ id: 'c2', paid_amount: 20, scout_first_name: 'Jane', scout_last_name: 'Smith' }),
    charge({ id: 'c3', scout_first_name: 'Sam', scout_last_name: 'Lee' }),
    charge({ id: 'c4', scout_first_name: 'Alex', scout_last_name: 'Reed' }),
  ],
}

const recordAllUnpaid: BillingRecordEntry = {
  ...recordWithMixed,
  id: 'r2',
  description: 'Field Trip',
  charges: [
    charge({ id: 'd1' }),
    charge({ id: 'd2' }),
    charge({ id: 'd3' }),
    charge({ id: 'd4' }),
  ],
}

describe('BillingManagementView — row amount column', () => {
  it('shows outstanding total ($130) and "of $200 billed" subtext for mixed-status record', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    expect(screen.getByText('$130.00')).toBeInTheDocument()
    expect(screen.getByText(/of \$200\.00 billed/i)).toBeInTheDocument()
  })

  it('shows only $200 with no "of $X billed" subtext for all-unpaid record (regression guard)', () => {
    render(
      <BillingManagementView
        records={[recordAllUnpaid]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    // $200.00 appears in the summary cards too — confirm at least one instance is present
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0)
    expect(screen.queryByText(/of \$/i)).not.toBeInTheDocument()
  })
})

describe('BillingManagementView — expanded per-charge rows', () => {
  it('shows Partial badge + remaining amount + "of $X billed" subtext for partial charge', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    // Click the expand chevron for the first record
    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    expect(expandButton).toBeDefined()
    fireEvent.click(expandButton!)

    // Jane Smith is the partial scout ($20 of $50 paid → $30 remaining)
    const janeRow = screen.getByText('Jane Smith').closest('div')!.parentElement!
    expect(within(janeRow).getByText('Partial')).toBeInTheDocument()
    expect(within(janeRow).getByText('$30.00')).toBeInTheDocument()
    expect(within(janeRow).getByText(/of \$50\.00 billed/i)).toBeInTheDocument()
  })

  it('renders per-charge Unpaid badge with stone (neutral) classes, not amber', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    fireEvent.click(expandButton!)

    // Sam Lee is fully unpaid — badge should be neutral stone, not amber
    const samRow = screen.getByText('Sam Lee').closest('div')!.parentElement!
    const unpaidBadge = within(samRow).getByText('Unpaid')
    expect(unpaidBadge.className).toMatch(/stone-/)
    expect(unpaidBadge.className).not.toMatch(/amber-/)
  })

  it('renders Paid badge unchanged for fully-paid charge (regression guard)', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    fireEvent.click(expandButton!)

    const johnRow = screen.getByText('John Doe').closest('div')!.parentElement!
    expect(within(johnRow).getByText(/Paid/)).toBeInTheDocument()
  })
})
