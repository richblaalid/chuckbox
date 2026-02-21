import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PamphletLink } from '@/components/advancement/pamphlet-link'

describe('PamphletLink', () => {
  it('renders nothing when url is null', () => {
    const { container } = render(<PamphletLink url={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when url is undefined', () => {
    const { container } = render(<PamphletLink url={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders a clickable link with the pamphlet URL', () => {
    render(<PamphletLink url="https://filestore.scouting.org/camping.pdf" />)
    const link = screen.getByRole('link', { name: /pamphlet/i })
    expect(link).toHaveAttribute('href', 'https://filestore.scouting.org/camping.pdf')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
