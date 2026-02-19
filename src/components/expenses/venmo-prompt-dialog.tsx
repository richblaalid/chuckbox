'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateProfile } from '@/app/actions/profile'

interface VenmoPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (username: string) => void
}

export function VenmoPromptDialog({
  open,
  onOpenChange,
  onSaved,
}: VenmoPromptDialogProps) {
  const [username, setUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = username.trim().replace(/^@/, '')

  const handleSave = async () => {
    if (!trimmed) {
      setError('Please enter your Venmo username')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const result = await updateProfile({ venmo_username: trimmed })

      if (!result.success) {
        setError(result.error || 'Failed to save Venmo username')
        return
      }

      onSaved(trimmed)
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setUsername('')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Your Venmo Username</DialogTitle>
          <DialogDescription>
            To generate payment request links for other parents, we need your
            Venmo username. You can find it in the Venmo app under your profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="venmo-username">Venmo Username</Label>
          <div className="flex items-center gap-2">
            <span className="text-stone-500">@</span>
            <Input
              id="venmo-username"
              placeholder="your-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Skip
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !trimmed}>
            {isSubmitting ? 'Saving...' : 'Save & Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
