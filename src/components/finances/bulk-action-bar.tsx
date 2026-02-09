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
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
      <span className="text-sm font-medium text-primary">
        {selectedCount} scout{selectedCount !== 1 ? 's' : ''} selected
      </span>
      <div className="ml-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBillSelected}>
          <Receipt className="mr-1.5 h-3.5 w-3.5" />
          Bill Selected
        </Button>
        <Button variant="outline" size="sm" onClick={onAddFunds}>
          <PiggyBank className="mr-1.5 h-3.5 w-3.5" />
          Add Funds
        </Button>
        <Button variant="outline" size="sm" onClick={onSendReminders}>
          <Bell className="mr-1.5 h-3.5 w-3.5" />
          Send Reminders
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  )
}
