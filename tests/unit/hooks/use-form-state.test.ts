import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormState, useFormStateWithFetch } from '@/hooks/use-form-state'

describe('useFormState', () => {
  it('should have correct initial state', () => {
    const { result } = renderHook(() => useFormState())

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBe(false)
  })

  it('should accept custom initial success value', () => {
    const { result } = renderHook(() => useFormState<string | null>(null))

    expect(result.current.success).toBeNull()
  })

  it('should set loading state and clear error on startLoading', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.handleError('previous error')
    })
    expect(result.current.error).toBe('previous error')

    act(() => {
      result.current.startLoading()
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBe(false)
  })

  it('should handle Error instances', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.handleError(new Error('Something broke'))
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBe('Something broke')
    expect(result.current.success).toBe(false)
  })

  it('should handle string errors', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.handleError('A string error')
    })

    expect(result.current.error).toBe('A string error')
  })

  it('should handle unknown error types', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.handleError(42)
    })

    expect(result.current.error).toBe('An unexpected error occurred')
  })

  it('should set success on handleSuccess with default value', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.startLoading()
    })
    expect(result.current.isLoading).toBe(true)

    act(() => {
      result.current.handleSuccess()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBe(true)
  })

  it('should set success on handleSuccess with custom value', () => {
    const { result } = renderHook(() =>
      useFormState<string | null>(null)
    )

    act(() => {
      result.current.handleSuccess('Saved!')
    })

    expect(result.current.success).toBe('Saved!')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should reset all state', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.startLoading()
      result.current.handleSuccess()
    })
    expect(result.current.success).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBe(false)
  })

  it('should provide direct setters', () => {
    const { result } = renderHook(() => useFormState())

    act(() => {
      result.current.setLoading(true)
    })
    expect(result.current.isLoading).toBe(true)

    act(() => {
      result.current.setError('manual error')
    })
    expect(result.current.error).toBe('manual error')

    act(() => {
      result.current.setSuccess(true)
    })
    expect(result.current.success).toBe(true)
  })
})

describe('useFormStateWithFetch', () => {
  it('should extend useFormState with fetch state', () => {
    const { result } = renderHook(() => useFormStateWithFetch())

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isFetching).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBe(false)
  })

  it('should set fetching state and clear error on startFetching', () => {
    const { result } = renderHook(() => useFormStateWithFetch())

    act(() => {
      result.current.handleError('error')
    })
    expect(result.current.error).toBe('error')

    act(() => {
      result.current.startFetching()
    })
    expect(result.current.isFetching).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('should stop fetching', () => {
    const { result } = renderHook(() => useFormStateWithFetch())

    act(() => {
      result.current.startFetching()
    })
    expect(result.current.isFetching).toBe(true)

    act(() => {
      result.current.stopFetching()
    })
    expect(result.current.isFetching).toBe(false)
  })

  it('should have independent fetch and submit loading states', () => {
    const { result } = renderHook(() => useFormStateWithFetch())

    act(() => {
      result.current.startFetching()
      result.current.startLoading()
    })
    expect(result.current.isFetching).toBe(true)
    expect(result.current.isLoading).toBe(true)

    act(() => {
      result.current.stopFetching()
    })
    expect(result.current.isFetching).toBe(false)
    expect(result.current.isLoading).toBe(true)
  })
})
