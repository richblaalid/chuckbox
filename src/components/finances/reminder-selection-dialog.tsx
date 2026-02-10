'use client'

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency } from '@/lib/utils'
import { Bell, Users } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance?: number | null
  } | null
  patrols: { name: string } | null
}

interface ReminderSelectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scouts: Scout[]
  onConfirm: (selectedAccountIds: string[]) => void
}

export function ReminderSelectionDialog({
  open,
  onOpenChange,
  scouts,
  onConfirm,
}: ReminderSelectionDialogProps) {
  // Get scouts who owe money
  const scoutsOwing = useMemo(() =>
    scouts
      .filter((s) => s.scout_accounts && (s.scout_accounts.billing_balance ?? 0) < 0)
      .map((s) => ({
        scoutId: s.id,
        accountId: s.scout_accounts!.id,
        name: `${s.last_name}, ${s.first_name}`,
        patrol: s.patrols?.name || null,
        amount: Math.abs(s.scout_accounts!.billing_balance ?? 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [scouts]
  )

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    new Set(scoutsOwing.map(s => s.accountId))
  )

  // Reset selection when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setSelectedIds(new Set(scoutsOwing.map(s => s.accountId)))
    }
    onOpenChange(isOpen)
  }

  const toggleScout = (accountId: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(accountId)) {
      newSelected.delete(accountId)
    } else {
      newSelected.add(accountId)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    setSelectedIds(new Set(scoutsOwing.map(s => s.accountId)))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const selectedScouts = scoutsOwing.filter(s => selectedIds.has(s.accountId))
  const totalSelected = selectedScouts.reduce((sum, s) => sum + s.amount, 0)
  const allSelected = selectedIds.size === scoutsOwing.length

  const handleConfirm = () => {
    onConfirm(Array.from(selectedIds))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Send Payment Reminders
          </DialogTitle>
          <DialogDescription>
            Select which scouts should receive reminder emails
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Selection controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-stone-600">
              <Users className="h-4 w-4" />
              <span>{selectedIds.size} of {scoutsOwing.length} selected</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={allSelected}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                disabled={selectedIds.size === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Scout list */}
          <div className="flex-1 overflow-y-auto border rounded-lg divide-y">
            {scoutsOwing.map((scout) => (
              <label
                key={scout.accountId}
                className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.has(scout.accountId)}
                  onCheckedChange={() => toggleScout(scout.accountId)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-stone-900 truncate">{scout.name}</p>
                  {scout.patrol && (
                    <p className="text-xs text-stone-500">{scout.patrol}</p>
                  )}
                </div>
                <span className="text-sm font-medium text-error">
                  {formatCurrency(scout.amount)}
                </span>
              </label>
            ))}
          </div>

          {/* Summary */}
          {selectedIds.size > 0 && (
            <div className="rounded-lg bg-stone-50 px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">Selected scouts:</span>
                <span className="font-medium">{selectedIds.size}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-stone-600">Total owed:</span>
                <span className="font-medium text-error">{formatCurrency(totalSelected)}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="gap-2"
          >
            <Bell className="h-4 w-4" />
            Continue ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
