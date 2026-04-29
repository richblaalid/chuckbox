'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronDown, Plus, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnit } from '@/components/providers/unit-context'
import { useFeatureFlag, FeatureFlag } from '@/lib/feature-flags'
import { UnitLogo } from './unit-logo'

export function UnitSwitcher() {
  const { currentUnit, units, switchUnit } = useUnit()
  const isMultiUnitEnabled = useFeatureFlag(FeatureFlag.MULTI_UNIT_CREATION)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Single unit OR feature flag off — show static logo, no dropdown
  if (units.length <= 1 || !isMultiUnitEnabled) {
    return (
      <div className="flex flex-col items-center gap-3">
        <UnitLogo size="md" />
      </div>
    )
  }

  // Multi-unit — show clickable switcher
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50"
      >
        <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
          <UnitLogo size="md" />
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 shrink-0 text-stone-400 transition-transform",
          isOpen && "rotate-180"
        )} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-lg py-1">
          {units.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => {
                switchUnit(unit.id)
                setIsOpen(false)
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                unit.id === currentUnit?.id
                  ? "bg-forest-50 dark:bg-forest-900/20 text-forest-700 dark:text-forest-300"
                  : "text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/50"
              )}
            >
              {unit.id === currentUnit?.id && (
                <Check className="h-3.5 w-3.5 shrink-0 text-forest-600 dark:text-forest-400" />
              )}
              <span className={cn(
                "truncate",
                unit.id !== currentUnit?.id && "ml-[22px]"
              )}>
                {unit.name}
              </span>
            </button>
          ))}

          <div className="border-t border-stone-200 dark:border-stone-700 mt-1 pt-1">
            <Link
              href="/create-unit"
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-500 dark:text-stone-400 hover:text-forest-600 dark:hover:text-forest-400 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Add another unit</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
