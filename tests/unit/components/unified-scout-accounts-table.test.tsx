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
    // Header checkbox + 2 row checkboxes
    expect(checkboxes.length).toBe(3)
  })

  it('calls onSelectionChange when checkbox clicked', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // First row checkbox
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(['acc-1'])
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
    const filterButton = screen.getByRole('button', { name: /owes money/i })
    fireEvent.click(filterButton)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('shows selected state on rows', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} selectedIds={['acc-1']} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[1]).toBeChecked()
  })
})
