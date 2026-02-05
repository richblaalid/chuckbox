'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, CheckSquare, X, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectActionBarProps {
  /** Number of items currently selected */
  selectedCount: number
  /** Total number of selectable (incomplete) items */
  totalSelectableCount: number
  /** Called when "Select All" is clicked */
  onSelectAll: () => void
  /** Called when "Clear" is clicked */
  onClear: () => void
  /** Called when "Sign Off" is clicked - opens bulk approval */
  onSignOff: () => void
  /** Whether the action bar is visible */
  visible: boolean
  /** Optional class name for the container */
  className?: string
}

export function MultiSelectActionBar({
  selectedCount,
  totalSelectableCount,
  onSelectAll,
  onClear,
  onSignOff,
  visible,
  className,
}: MultiSelectActionBarProps) {
  // Use portal to render in document body, bypassing any parent transforms
  // that would break fixed positioning (e.g., framer-motion animations)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: hydration safety for portal rendering
    setMounted(true)
  }, [])

  if (!visible || !mounted) return null

  const allSelected = selectedCount === totalSelectableCount && totalSelectableCount > 0
  const hasSelection = selectedCount > 0

  const content = (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 transform',
        'animate-in slide-in-from-bottom-4 fade-in duration-200',
        className
      )}
    >
      <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-2 py-1.5 shadow-lg sm:gap-3 sm:px-4 sm:py-2">
        {/* Selection Count */}
        <Badge
          variant="secondary"
          className={cn(
            'px-2.5 py-1 text-sm font-medium',
            hasSelection
              ? 'bg-blue-100 text-blue-700'
              : 'bg-stone-100 text-stone-600'
          )}
        >
          <ListChecks className="mr-1.5 h-3.5 w-3.5" />
          {selectedCount} selected
        </Badge>

        {/* Divider */}
        <div className="h-6 w-px bg-stone-200" />

        {/* Select All / Clear */}
        <div className="flex items-center gap-1">
          {!allSelected && totalSelectableCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              className="h-8 gap-1.5 text-xs text-stone-600 hover:text-stone-900"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Select All</span>
            </Button>
          )}
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-8 gap-1.5 text-xs text-stone-600 hover:text-stone-900"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-stone-200" />

        {/* Sign Off Action */}
        <Button
          size="sm"
          onClick={onSignOff}
          disabled={!hasSelection}
          className={cn(
            'h-8 gap-1.5',
            hasSelection
              ? 'bg-forest-600 hover:bg-forest-700 text-white'
              : 'bg-stone-100 text-stone-400'
          )}
        >
          <Check className="h-3.5 w-3.5" />
          Sign Off{hasSelection && ` (${selectedCount})`}
        </Button>
      </div>
    </div>
  )

  // Render via portal to document.body to escape any CSS containing blocks
  return createPortal(content, document.body)
}
