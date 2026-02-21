import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LinkifiedText } from '@/components/ui/linkified-text'

describe('LinkifiedText', () => {
  it('renders plain text without links unchanged', () => {
    render(<LinkifiedText text="No links here, just plain text." />)
    expect(screen.getByText('No links here, just plain text.')).toBeInTheDocument()
  })

  it('renders https URLs as clickable links', () => {
    render(<LinkifiedText text="Visit https://example.com for more info." />)
    const link = screen.getByRole('link', { name: 'https://example.com' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders http URLs as clickable links', () => {
    render(<LinkifiedText text="Go to http://example.org now." />)
    const link = screen.getByRole('link', { name: 'http://example.org' })
    expect(link).toHaveAttribute('href', 'http://example.org')
  })

  it('renders www URLs with https prefix', () => {
    render(<LinkifiedText text="Check www.example.com for details." />)
    const link = screen.getByRole('link', { name: 'www.example.com' })
    expect(link).toHaveAttribute('href', 'https://www.example.com')
  })

  it('handles multiple URLs in the same text', () => {
    render(
      <LinkifiedText text="Visit https://first.com and https://second.com today." />
    )
    expect(screen.getByRole('link', { name: 'https://first.com' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://second.com' })).toBeInTheDocument()
  })

  it('handles URLs with paths and query params', () => {
    render(
      <LinkifiedText text="See https://example.com/path?q=test&page=1 for results." />
    )
    const link = screen.getByRole('link', { name: 'https://example.com/path?q=test&page=1' })
    expect(link).toHaveAttribute('href', 'https://example.com/path?q=test&page=1')
  })

  it('does not linkify partial matches like email addresses', () => {
    render(<LinkifiedText text="Email user@example.com for help." />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders empty string without error', () => {
    const { container } = render(<LinkifiedText text="" />)
    expect(container.textContent).toBe('')
  })
})
