import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FinanceSubnav } from '@/components/finances/finance-subnav'

// Mock usePathname
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/finances'),
}))

describe('FinanceSubnav', () => {
  it('renders all 6 tabs: Overview, Scout Accounts, Billing, Payments, Expenses, Reports', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /scout accounts/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /billing/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /payments/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /expenses/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument()
  })

  it('does not render deprecated tabs (Collection, Transactions)', () => {
    render(<FinanceSubnav />)

    expect(screen.queryByRole('link', { name: /^collection$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^transactions$/i })).not.toBeInTheDocument()
  })

  it('always renders Payments tab with correct link', () => {
    render(<FinanceSubnav />)
    expect(screen.getByRole('link', { name: /payments/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /payments/i })).toHaveAttribute('href', '/finances/payments')
  })

  it('renders 6 links', () => {
    render(<FinanceSubnav />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBe(6)
  })

  it('links to correct routes', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('href', '/finances')
    expect(screen.getByRole('link', { name: /scout accounts/i })).toHaveAttribute('href', '/finances/accounts')
    expect(screen.getByRole('link', { name: /billing/i })).toHaveAttribute('href', '/finances/billing')
    expect(screen.getByRole('link', { name: /payments/i })).toHaveAttribute('href', '/finances/payments')
    expect(screen.getByRole('link', { name: /expenses/i })).toHaveAttribute('href', '/expenses')
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/finances/reports')
  })
})
