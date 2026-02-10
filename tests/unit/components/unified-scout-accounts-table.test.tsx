import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnifiedScoutAccountsTable } from '@/components/finances/unified-scout-accounts-table'

const mockScouts = [
  {
    id: 'acc-1',
    scoutId: 'scout-1',
    scoutName: 'Smith, John',
    patrolName: 'Eagle',
    billingBalance: -125.0,
    fundsBalance: 45.0,
    lastActivity: '2026-01-15',
    isActive: true,
    daysOverdue: 45, // 45 days overdue
  },
  {
    id: 'acc-2',
    scoutId: 'scout-2',
    scoutName: 'Jones, Sarah',
    patrolName: 'Bear',
    billingBalance: 0,
    fundsBalance: 200.0,
    lastActivity: '2026-02-01',
    isActive: true,
    daysOverdue: 0, // Not overdue
  },
  {
    id: 'acc-3',
    scoutId: 'scout-3',
    scoutName: 'Williams, Mike',
    patrolName: 'Eagle',
    billingBalance: -50.0,
    fundsBalance: 0,
    lastActivity: '2026-02-05',
    isActive: true,
    daysOverdue: 15, // 15 days - not overdue (< 30)
  },
]

describe('UnifiedScoutAccountsTable', () => {
  const defaultProps = {
    scouts: mockScouts,
    patrols: ['Eagle', 'Bear'],
    onScoutSelect: vi.fn(),
    onSelectionChange: vi.fn(),
    selectedIds: [] as string[],
  }

  it('renders all scouts in the table', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.getByText('Jones, Sarah')).toBeInTheDocument()
  })

  it('displays balance columns correctly', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    expect(screen.getByText('-$125.00')).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
  })

  it('renders checkboxes for each row', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    // Header checkbox + 3 row checkboxes
    expect(checkboxes.length).toBe(4)
  })

  it('calls onSelectionChange when checkbox clicked', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    // Note: Sorted by name ascending, so order is: Jones (acc-2), Smith (acc-1), Williams (acc-3)
    fireEvent.click(checkboxes[1]) // First row checkbox (Jones)
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(['acc-2'])
  })

  it('calls onScoutSelect when row clicked', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    fireEvent.click(screen.getByText('Smith, John'))
    expect(defaultProps.onScoutSelect).toHaveBeenCalledWith(mockScouts[0])
  })

  it('filters by search term', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'Smith' } })
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('filters by balance state', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const filterButton = screen.getByRole('radio', { name: /owes money/i })
    fireEvent.click(filterButton)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('shows selected state on rows', () => {
    // Note: Sorted by name ascending, so order is: Jones (acc-2), Smith (acc-1), Williams (acc-3)
    // acc-1 (Smith) is at index 2 (header is 0, Jones is 1, Smith is 2)
    render(<UnifiedScoutAccountsTable {...defaultProps} selectedIds={['acc-1']} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[2]).toBeChecked() // Smith is 2nd row (index 2 after header)
  })

  it('filters by overdue status (30+ days)', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const filterButton = screen.getByRole('radio', { name: /overdue/i })
    fireEvent.click(filterButton)
    // Smith has 45 days overdue (should show)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    // Williams has 15 days overdue (should NOT show - under 30)
    expect(screen.queryByText('Williams, Mike')).not.toBeInTheDocument()
    // Jones has 0 days (should NOT show)
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('renders overdue filter option', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    expect(screen.getByRole('radio', { name: /overdue/i })).toBeInTheDocument()
  })
})
