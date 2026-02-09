'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, Receipt, CreditCard, BarChart3, AlertTriangle, FileText } from 'lucide-react'

interface FinanceSubnavProps {
  /** Whether to show billing and payments tabs (admin/treasurer only) */
  showFinancialTabs?: boolean
}

const tabs = [
  {
    label: 'Overview',
    href: '/finances',
    icon: LayoutDashboard,
    requiresFinancial: true, // Only admin/treasurer/leader see overview
  },
  {
    label: 'Accounts',
    href: '/finances/accounts',
    icon: Users,
    requiresFinancial: false, // Everyone can see accounts (filtered)
  },
  {
    label: 'Billing',
    href: '/finances/billing',
    icon: Receipt,
    requiresFinancial: true,
  },
  {
    label: 'Payments',
    href: '/finances/payments',
    icon: CreditCard,
    requiresFinancial: true,
  },
  {
    label: 'Collection',
    href: '/finances/collection',
    icon: AlertTriangle,
    requiresFinancial: true,
  },
  {
    label: 'Reports',
    href: '/finances/reports',
    icon: BarChart3,
    requiresFinancial: true,
  },
  {
    label: 'Transactions',
    href: '/finances/transactions',
    icon: FileText,
    requiresFinancial: true,
  },
]

export function FinanceSubnav({ showFinancialTabs = true }: FinanceSubnavProps) {
  const pathname = usePathname()

  // Filter tabs based on role
  const visibleTabs = tabs.filter(tab => {
    if (tab.requiresFinancial && !showFinancialTabs) {
      return false
    }
    return true
  })

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
        {visibleTabs.map((tab) => {
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
