import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BillingForm } from '@/components/billing/billing-form'

// Track calls to supabase.from(...).update(...)
const mockUpdate = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn().mockReturnValue(mockUpdate)
// Make mockUpdate chainable: .update(...).eq(...)
mockUpdate.mockImplementation(() => ({ eq: mockEq }))

const mockRpc = vi.fn().mockResolvedValue({
  data: { success: true, billing_record_id: 'br1', journal_entry_id: 'je1' },
  error: null,
})

const mockFrom = vi.fn().mockReturnValue({
  update: mockUpdate,
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/lib/analytics', () => ({
  trackBillingCreated: vi.fn(),
}))

const scout = (i: number, first: string, last: string) => ({
  id: `s${i}`,
  first_name: first,
  last_name: last,
  is_active: true,
  scout_accounts: { id: `acct${i}` },
  patrols: null,
})

const baseProps = {
  unitId: 'unit1',
  scouts: [scout(1, 'Alex', 'Reed'), scout(2, 'Jamie', 'Lee')],
  onSuccess: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRpc.mockResolvedValue({
    data: { success: true, billing_record_id: 'br1', journal_entry_id: 'je1' },
    error: null,
  })
  mockUpdate.mockImplementation(() => ({ eq: mockEq }))
  mockEq.mockResolvedValue({ error: null })
})

describe('BillingForm — line items as source of truth', () => {
  it('renders one empty line-item row by default with no remove button on it', () => {
    render(<BillingForm {...baseProps} />)
    expect(screen.queryByPlaceholderText(/total amount/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add itemized breakdown/i })).not.toBeInTheDocument()
    expect(screen.queryAllByLabelText('Remove line item')).toHaveLength(0)
  })

  it('shows the read-only Total auto-derived from the line-item amounts', () => {
    render(<BillingForm {...baseProps} />)
    // The items box has a "Total" span (may share "Total" with "Split Total" toggle button)
    const totalLabels = screen.getAllByText(/^Total$/)
    expect(totalLabels.length).toBeGreaterThanOrEqual(1)
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument()
  })

  it('reveals a second row with description + amount + remove when "Add another item" is clicked', () => {
    render(<BillingForm {...baseProps} />)
    const addButton = screen.getByRole('button', { name: /add another item/i })
    fireEvent.click(addButton)
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(2)
    expect(screen.getAllByLabelText('Remove line item').length).toBeGreaterThanOrEqual(1)
  })

  it('removes a row when its × is clicked', () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(2)
    const removeButtons = screen.getAllByLabelText('Remove line item')
    fireEvent.click(removeButtons[0])
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(1)
    expect(screen.queryAllByLabelText('Remove line item')).toHaveLength(0)
  })

  it('submits a single-row entry with blank description as non-itemized (line_items: null)', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Single Item Test' },
    })
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    const submitButton = screen.getByRole('button', { name: /create billing/i })
    fireEvent.click(submitButton)
    await vi.waitFor(() => {
      expect(mockRpc).toHaveBeenCalled()
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('submits a single-row entry with a filled description as itemized with one item', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'One-Item Bill' },
    })
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    const descInputs = screen.getAllByPlaceholderText(/describe what this bill covers|description/i)
    fireEvent.change(descInputs[0], { target: { value: 'Camp fee' } })
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    await vi.waitFor(() => expect(mockRpc).toHaveBeenCalled())
    // Should call update with non-null line_items
    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const updateArg = mockUpdate.mock.calls[0][0]
    expect(updateArg.line_items).not.toBeNull()
    expect(updateArg.line_items[0].description).toBe('Camp fee')
  })

  it('blocks submit when 2+ rows exist and one is missing a description', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Missing Desc Test' },
    })
    const amountInputs1 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs1[0], { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    const amountInputs2 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs2[1], { target: { value: '30' } })
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    await new Promise((r) => setTimeout(r, 50))
    expect(mockRpc).not.toHaveBeenCalled()
    // Message appears in both the top alert and the inline row error — check at least one is present.
    expect(screen.getAllByText(/Line item 1 needs a description/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows a red ring on the row that fails validation', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Missing Desc Test' },
    })
    const amountInputs1 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs1[0], { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    const amountInputs2 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs2[1], { target: { value: '30' } })
    // Leave descriptions blank.
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    // Wait for the error state to be set + rendered.
    await new Promise((r) => setTimeout(r, 50))
    // Row 0 (rowIndex 0) should have the red-ring class on its inner flex container.
    const errorRow = document.querySelector('[data-line-item-row="0"]')
    expect(errorRow).not.toBeNull()
    // The visual ring is on the inner div within the row wrapper.
    const innerFlex = errorRow!.querySelector('.flex')
    expect(innerFlex?.className).toMatch(/ring-red-500/)
  })

  it('clears the error when the user starts editing a line-item input', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Clear Error Test' },
    })
    const amountInputs1 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs1[0], { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    const amountInputs2 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs2[1], { target: { value: '30' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    await new Promise((r) => setTimeout(r, 50))
    // Error appears in at least one place (top alert + inline row).
    expect(screen.getAllByText(/Line item 1 needs a description/i).length).toBeGreaterThanOrEqual(1)
    // Edit the first row's description.
    const descInputs = screen.getAllByPlaceholderText(/describe what this bill covers|description/i)
    fireEvent.change(descInputs[0], { target: { value: 'Tent rental' } })
    // Error disappears from all locations.
    expect(screen.queryAllByText(/Line item 1 needs a description/i)).toHaveLength(0)
  })
})
