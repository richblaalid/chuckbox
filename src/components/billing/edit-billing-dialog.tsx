'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

interface EditBillingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  billingRecordId: string
  currentDescription: string
}

export function EditBillingDialog({
  open,
  onOpenChange,
  billingRecordId,
  currentDescription,
}: EditBillingDialogProps) {
  const router = useRouter()
  const [description, setDescription] = useState(currentDescription)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!description.trim()) {
      setError('Description is required')
      return
    }

    if (description.trim() === currentDescription) {
      onOpenChange(false)
      return
    }

    setIsLoading(true)
    setError(null)

    const supabase = createClient()

    try {
       
      const { error: rpcError } = await supabase.rpc('update_billing_description', {
        p_billing_record_id: billingRecordId,
        p_new_description: description.trim(),
      })

      if (rpcError) throw rpcError

      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!isLoading) {
      if (!newOpen) {
        setDescription(currentDescription)
        setError(null)
      }
      onOpenChange(newOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Billing Record</DialogTitle>
          <DialogDescription>
            Update the description for this billing record. To change amounts,
            void this record and create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Summer Camp 2024"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-error-light p-3 text-sm text-error">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            loading={isLoading}
            loadingText="Saving..."
            disabled={!description.trim()}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
