import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FinanceSubnav } from '@/components/finances/finance-subnav'

// Mock usePathname
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/finances'),
}))

describe('FinanceSubnav', () => {
  it('renders exactly 3 tabs: Overview, Scout Accounts, Reports', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /scout accounts/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument()
  })

  it('does not render deprecated tabs (Billing, Payments, Collection, Transactions)', () => {
    render(<FinanceSubnav />)

    expect(screen.queryByRole('link', { name: /^billing$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^payments$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^collection$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^transactions$/i })).not.toBeInTheDocument()
  })

  it('links to correct routes', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('href', '/finances')
    expect(screen.getByRole('link', { name: /scout accounts/i })).toHaveAttribute('href', '/finances/accounts')
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/finances/reports')
  })

  it('renders only 3 links total', () => {
    render(<FinanceSubnav />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBe(3)
  })
})
