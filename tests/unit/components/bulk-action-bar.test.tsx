import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from '@/components/finances/bulk-action-bar'

describe('BulkActionBar', () => {
  const defaultProps = {
    selectedCount: 3,
    onBillSelected: vi.fn(),
    onSendReminders: vi.fn(),
    onClearSelection: vi.fn(),
  }

  it('displays selected count', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByText('3 scouts selected')).toBeInTheDocument()
  })

  it('renders all action buttons', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: /bill selected/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reminders/i })).toBeInTheDocument()
    // Two clear buttons exist (mobile + desktop), both should render
    expect(screen.getAllByRole('button', { name: /clear/i })).toHaveLength(2)
  })

  it('calls onBillSelected when Bill Selected clicked', () => {
    render(<BulkActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /bill selected/i }))
    expect(defaultProps.onBillSelected).toHaveBeenCalled()
  })

  it('calls onClearSelection when Clear clicked', () => {
    render(<BulkActionBar {...defaultProps} />)
    fireEvent.click(screen.getAllByRole('button', { name: /clear/i })[0])
    expect(defaultProps.onClearSelection).toHaveBeenCalled()
  })

  it('is hidden when selectedCount is 0', () => {
    const { container } = render(<BulkActionBar {...defaultProps} selectedCount={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows singular "scout" when only 1 selected', () => {
    render(<BulkActionBar {...defaultProps} selectedCount={1} />)
    expect(screen.getByText('1 scout selected')).toBeInTheDocument()
  })
})
