'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, BarChart3 } from 'lucide-react'

const tabs = [
  { label: 'Overview', href: '/finances', icon: LayoutDashboard },
  { label: 'Scout Accounts', href: '/finances/accounts', icon: Users },
  { label: 'Reports', href: '/finances/reports', icon: BarChart3 },
]

export function FinanceSubnav() {
  const pathname = usePathname()

  // Determine active tab - handle nested routes like /finances/accounts/[id]
  const getIsActive = (href: string) => {
    if (href === '/finances') {
      return pathname === '/finances'
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="border-b border-stone-200">
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = getIsActive(tab.href)

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-3 px-4 py-3 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-forest-600 text-stone-900'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
