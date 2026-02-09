import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScoutDetailSidePanel } from '@/components/finances/scout-detail-side-panel'

const mockScout = {
  id: 'acc-1',
  scoutId: 'scout-1',
  scoutName: 'John Smith',
  patrolName: 'Eagle',
  isActive: true,
  billingBalance: -125.0,
  fundsBalance: 45.0,
  lastActivity: '2026-01-15',
  recentTransactions: [
    { id: '1', date: '2026-01-15', description: 'Payment received', amount: 50.0 },
    { id: '2', date: '2026-01-10', description: 'Camp fee charge', amount: -175.0 },
  ],
}

describe('ScoutDetailSidePanel', () => {
  const defaultProps = {
    scout: mockScout,
    isOpen: true,
    onClose: vi.fn(),
    onRecordPayment: vi.fn(),
    onUseFunds: vi.fn(),
    onAddFunds: vi.fn(),
    onSendReminder: vi.fn(),
  }

  it('displays scout name and patrol', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('John Smith')).toBeInTheDocument()
    expect(screen.getByText(/Eagle/)).toBeInTheDocument()
  })

  it('displays balances correctly', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('-$125.00')).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
  })

  it('shows contextual actions for scout who owes money with funds', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use funds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reminder/i })).toBeInTheDocument()
  })

  it('shows different actions for scout with zero balance and funds', () => {
    const noBalanceScout = { ...mockScout, billingBalance: 0 }
    render(<ScoutDetailSidePanel {...defaultProps} scout={noBalanceScout} />)
    expect(screen.getByRole('button', { name: /add funds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use funds/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('displays recent transactions', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText('Camp fee charge')).toBeInTheDocument()
  })

  it('has closed data-state when isOpen is false', () => {
    const { container } = render(<ScoutDetailSidePanel {...defaultProps} isOpen={false} />)
    expect(container.querySelector('[data-state="closed"]')).toBeInTheDocument()
  })

  it('returns null when scout is null', () => {
    const { container } = render(<ScoutDetailSidePanel {...defaultProps} scout={null} />)
    expect(container.firstChild).toBeNull()
  })
})
