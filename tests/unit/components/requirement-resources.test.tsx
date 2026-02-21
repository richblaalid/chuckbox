import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RequirementResources } from '@/components/advancement/requirement-resources'

describe('RequirementResources', () => {
  it('renders nothing when resources array is empty', () => {
    const { container } = render(<RequirementResources resources={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when resources is undefined', () => {
    const { container } = render(<RequirementResources resources={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders a video resource as a clickable link', () => {
    render(
      <RequirementResources
        resources={[
          { name: 'How to Tie Knots', url: 'https://youtube.com/watch?v=123', resource_type: 'video' },
        ]}
      />
    )
    const link = screen.getByRole('link', { name: /How to Tie Knots/i })
    expect(link).toHaveAttribute('href', 'https://youtube.com/watch?v=123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders a website resource as a clickable link', () => {
    render(
      <RequirementResources
        resources={[
          { name: 'BSA Official Site', url: 'https://scouting.org', resource_type: 'website' },
        ]}
      />
    )
    const link = screen.getByRole('link', { name: /BSA Official Site/i })
    expect(link).toHaveAttribute('href', 'https://scouting.org')
  })

  it('renders a PDF resource as a clickable link', () => {
    render(
      <RequirementResources
        resources={[
          { name: 'Safety Guide', url: 'https://example.com/guide.pdf', resource_type: 'pdf' },
        ]}
      />
    )
    const link = screen.getByRole('link', { name: /Safety Guide/i })
    expect(link).toHaveAttribute('href', 'https://example.com/guide.pdf')
  })

  it('renders multiple resources', () => {
    render(
      <RequirementResources
        resources={[
          { name: 'Video One', url: 'https://youtube.com/1', resource_type: 'video' },
          { name: 'Website Two', url: 'https://example.com', resource_type: 'website' },
          { name: 'PDF Three', url: 'https://example.com/3.pdf', resource_type: 'pdf' },
        ]}
      />
    )
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })
})
