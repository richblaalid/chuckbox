import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VenmoPromptDialog } from '@/components/expenses/venmo-prompt-dialog'

// Mock updateProfile
const mockUpdateProfile = vi.fn()
vi.mock('@/app/actions/profile', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}))

describe('VenmoPromptDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateProfile.mockResolvedValue({ success: true })
  })

  it('renders dialog with username input', () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    expect(screen.getByText('Add Your Venmo Username')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('your-username')).toBeInTheDocument()
  })

  it('renders Save & Continue and Skip buttons', () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /save & continue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
  })

  it('disables Save button when input is empty', () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /save & continue/i })).toBeDisabled()
  })

  it('enables Save button when username is entered', () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('your-username'), {
      target: { value: 'john-doe' },
    })
    expect(screen.getByRole('button', { name: /save & continue/i })).not.toBeDisabled()
  })

  it('calls updateProfile and onSaved on save', async () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('your-username'), {
      target: { value: 'john-doe' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({ venmo_username: 'john-doe' })
      expect(defaultProps.onSaved).toHaveBeenCalledWith('john-doe')
    })
  })

  it('strips @ prefix from username before saving', async () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('your-username'), {
      target: { value: '@john-doe' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({ venmo_username: 'john-doe' })
    })
  })

  it('shows error when updateProfile fails', async () => {
    mockUpdateProfile.mockResolvedValue({ success: false, error: 'Network error' })
    render(<VenmoPromptDialog {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('your-username'), {
      target: { value: 'john-doe' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('calls onOpenChange when Skip is clicked', () => {
    render(<VenmoPromptDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })
})
