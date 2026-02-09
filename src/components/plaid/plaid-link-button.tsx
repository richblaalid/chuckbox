'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink, PlaidLinkOnSuccess, PlaidLinkOnExit } from 'react-plaid-link'
import { Button } from '@/components/ui/button'
import { Landmark, Loader2 } from 'lucide-react'

interface PlaidLinkButtonProps {
  onSuccess?: () => void
  onExit?: () => void
  className?: string
}

export function PlaidLinkButton({ onSuccess, onExit, className }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch link token on mount
  useEffect(() => {
    const fetchLinkToken = async () => {
      try {
        const response = await fetch('/api/plaid/create-link-token', {
          method: 'POST',
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to create link token')
        }

        const data = await response.json()
        setLinkToken(data.link_token)
      } catch (err) {
        console.error('Error fetching link token:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize bank connection')
      }
    }

    fetchLinkToken()
  }, [])

  // Handle successful bank connection
  const handleSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            public_token: publicToken,
            institution: metadata.institution,
            accounts: metadata.accounts,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to connect bank account')
        }

        onSuccess?.()
      } catch (err) {
        console.error('Error exchanging token:', err)
        setError(err instanceof Error ? err.message : 'Failed to connect bank account')
      } finally {
        setLoading(false)
      }
    },
    [onSuccess]
  )

  // Handle Link exit
  const handleExit: PlaidLinkOnExit = useCallback(
    (err) => {
      if (err) {
        console.error('Plaid Link error:', err)
        setError(err.display_message || 'An error occurred during bank connection')
      }
      onExit?.()
    },
    [onExit]
  )

  const config = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: handleExit,
  }

  const { open, ready } = usePlaidLink(config)

  if (error) {
    return (
      <div className="text-sm text-error">
        {error}
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            setError(null)
            setLinkToken(null)
            // Re-fetch link token
            fetch('/api/plaid/create-link-token', { method: 'POST' })
              .then((res) => res.json())
              .then((data) => setLinkToken(data.link_token))
              .catch((err) => setError(err.message))
          }}
          className="ml-2"
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <Button
      onClick={() => open()}
      disabled={!ready || loading}
      className={className}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Landmark className="mr-2 h-4 w-4" />
          Connect Bank Account
        </>
      )}
    </Button>
  )
}
