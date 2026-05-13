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

    expect(screen.getAllByText('$130.00').length).toBeGreaterThan(0)
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

  it('summary card Outstanding shows partial-aware total ($130, not $150) for mixed-status record', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    // The summary stat card labeled "Outstanding" should display $130 (the
    // partial-aware total), not $150 (which would double-count the partial
    // charge by ignoring paid_amount). Find the card by its descriptor label
    // and verify the title within.
    const outstandingLabel = screen.getByText('Outstanding')
    const card = outstandingLabel.closest('[class*="CardHeader"]') || outstandingLabel.parentElement!
    expect(card.textContent).toContain('$130.00')
    expect(card.textContent).not.toContain('$150.00')
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
    const janeRow = screen.getByTestId('charge-row-c2')
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
    const samRow = screen.getByTestId('charge-row-c3')
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

    const johnRow = screen.getByTestId('charge-row-c1')
    expect(within(johnRow).getByText(/Paid/)).toBeInTheDocument()
  })

  it('renders Paid badge when paid_amount >= amount even if is_paid is false (defensive guard)', () => {
    // Bug observed in dev: a charge with paid_amount inflated to amount (via the
    // ChargeAllocationList full-owed allocation bug) but is_paid still false
    // (because the reconcile trigger only flips is_paid when billing_balance is
    // fully covered). The row-level helper says "Paid" via chargeStatus's
    // defensive guard, so the per-charge row must agree.
    const recordInconsistent: BillingRecordEntry = {
      id: 'r-inc',
      description: 'dddd',
      billing_date: '2026-05-13',
      created_at: '2026-05-13T00:00:00Z',
      total_amount: 25,
      is_void: false,
      batch_id: null,
      charges: [
        charge({
          id: 'c-inc',
          amount: 25,
          paid_amount: 25, // inflated via the allocation bug
          is_paid: false,  // reconcile trigger hasn't fired
          scout_first_name: 'Alex',
          scout_last_name: 'A.',
        }),
      ],
    }

    render(
      <BillingManagementView
        records={[recordInconsistent]}
        scouts={[scout(99, 'Alex', 'A.')]}
        unitId="unit1"
      />
    )

    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    fireEvent.click(expandButton!)

    const alexRow = screen.getByTestId('charge-row-c-inc')
    expect(within(alexRow).getByText(/Paid/)).toBeInTheDocument()
    expect(within(alexRow).queryByText('Unpaid')).not.toBeInTheDocument()
    expect(within(alexRow).queryByText('Partial')).not.toBeInTheDocument()
    // No Record Payment button on a Paid (even-if-defensive) charge
    expect(within(alexRow).queryByText('Record Payment')).not.toBeInTheDocument()
  })

  it('row paid count uses chargeStatus, not raw is_paid (defensive-paid charges count as paid)', () => {
    const recordInconsistent: BillingRecordEntry = {
      id: 'r-count',
      description: 'count check',
      billing_date: '2026-05-13',
      created_at: '2026-05-13T00:00:00Z',
      total_amount: 25,
      is_void: false,
      batch_id: null,
      charges: [
        charge({
          id: 'c-count',
          amount: 25,
          paid_amount: 25,
          is_paid: false,
          scout_first_name: 'Alex',
          scout_last_name: 'A.',
        }),
      ],
    }

    render(
      <BillingManagementView
        records={[recordInconsistent]}
        scouts={[scout(99, 'Alex', 'A.')]}
        unitId="unit1"
      />
    )

    // Row paid-count display: should show 1/1 (one effectively-paid charge),
    // not 0/1 (which would happen if it filtered by raw is_paid).
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.queryByText('0/1')).not.toBeInTheDocument()
  })
})

describe('BillingManagementView — scout name subtext', () => {
  const recordSingleScout: BillingRecordEntry = {
    id: 'r-single',
    description: 'Adventure Camp Deposit',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 50,
    is_void: false,
    batch_id: null,
    charges: [
      charge({
        id: 'c-single',
        amount: 50,
        paid_amount: 0,
        is_paid: false,
        scout_first_name: 'Alex',
        scout_last_name: 'Reed',
      }),
    ],
  }

  const recordRecordVoided: BillingRecordEntry = {
    id: 'r-void',
    description: 'Cancelled Trip',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 50,
    is_void: true,
    batch_id: null,
    charges: [
      charge({
        id: 'c-active-anyway',
        amount: 50,
        paid_amount: 0,
        is_paid: false,
        is_void: false,
        scout_first_name: 'Alex',
        scout_last_name: 'Reed',
      }),
    ],
  }

  const recordAllChargesVoided: BillingRecordEntry = {
    id: 'r-all-charges-voided',
    description: 'Dropped Members',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 100,
    is_void: false,
    batch_id: null,
    charges: [
      charge({ id: 'c-v1', is_void: true, scout_first_name: 'Alex', scout_last_name: 'Reed' }),
      charge({ id: 'c-v2', is_void: true, scout_first_name: 'Sam', scout_last_name: 'Lee' }),
    ],
  }

  it('renders scout name as subtext for single-scout records', () => {
    render(
      <BillingManagementView
        records={[recordSingleScout]}
        scouts={[scout(99, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    expect(screen.getByText('Alex Reed')).toBeInTheDocument()
  })

  it('renders "Multiple Scouts" subtext for multi-scout records', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    expect(screen.getByText('Multiple Scouts')).toBeInTheDocument()
  })

  it('renders no scout subtext when record.is_void is true (even with active charges)', () => {
    render(
      <BillingManagementView
        records={[recordRecordVoided]}
        scouts={[scout(99, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    // The row is collapsed by default, so the only place 'Alex Reed' could
    // appear is in the new subtext. Asserting absence proves the subtext is
    // suppressed by the record.is_void predicate.
    expect(screen.queryByText('Alex Reed')).not.toBeInTheDocument()
    expect(screen.queryByText('Multiple Scouts')).not.toBeInTheDocument()
  })

  it('renders no scout subtext when all charges are voided', () => {
    render(
      <BillingManagementView
        records={[recordAllChargesVoided]}
        scouts={[scout(99, 'Alex', 'Reed'), scout(98, 'Sam', 'Lee')]}
        unitId="unit1"
      />
    )
    expect(screen.queryByText('Alex Reed')).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
    expect(screen.queryByText('Multiple Scouts')).not.toBeInTheDocument()
  })
})
