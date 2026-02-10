'use client'

import { Button } from '@/components/ui/button'
import { Receipt, PiggyBank, Bell, Download, X } from 'lucide-react'

interface BulkActionBarProps {
  selectedCount: number
  onBillSelected: () => void
  onAddFunds: () => void
  onSendReminders: () => void
  onExport: () => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  onBillSelected,
  onAddFunds,
  onSendReminders,
  onExport,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedCount === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 sm:flex-row sm:items-center sm:px-4">
      {/* Selection count with clear button on mobile */}
      <div className="flex items-center justify-between sm:justify-start">
        <span className="text-sm font-medium text-primary">
          {selectedCount} scout{selectedCount !== 1 ? 's' : ''} selected
        </span>
        {/* Clear button inline on mobile */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="sm:hidden"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Action buttons - wrap on mobile */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-2">
        <Button variant="outline" size="sm" onClick={onBillSelected}>
          <Receipt className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Bill Selected</span>
          <span className="sm:hidden">Bill</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onAddFunds}>
          <PiggyBank className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Add Funds</span>
          <span className="sm:hidden">Funds</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onSendReminders}>
          <Bell className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Send Reminders</span>
          <span className="sm:hidden">Remind</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Export</span>
          <span className="sm:hidden">Export</span>
        </Button>
        {/* Clear button visible on desktop */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="hidden sm:inline-flex"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  )
}
