'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getVisibleNavItems, isFinancialRole } from '@/lib/roles'
import { Logo } from '@/components/ui/logo'
import { UnitSwitcher } from './unit-switcher'
import { useUnit } from '@/components/providers/unit-context'
import { useSidebar } from '@/components/providers/sidebar-context'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { User } from '@supabase/supabase-js'

interface SidebarProps {
  user: User
  userName?: string | null
  className?: string
}

function getInitials(email: string, name?: string | null): string {
  if (name) {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }
  return email.substring(0, 2).toUpperCase()
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Admin',
    treasurer: 'Treasurer',
    leader: 'Leader',
    parent: 'Parent',
    scout: 'Scout',
  }
  return labels[role] || role
}

// Wrapper for nav items that shows tooltip when collapsed
function NavTooltip({
  children,
  label,
  isCollapsed
}: {
  children: React.ReactNode
  label: string
  isCollapsed: boolean
}) {
  if (!isCollapsed) {
    return <>{children}</>
  }

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" className="font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Sidebar({ user, userName, className }: SidebarProps) {
  const pathname = usePathname()
  const { currentRole } = useUnit()
  const { isCollapsed, toggleCollapsed } = useSidebar()
  const navItems = currentRole ? getVisibleNavItems(currentRole) : []
  const initials = getInitials(user.email || '', userName)
  const userRole = currentRole || 'parent'

  const showSettings = isFinancialRole(userRole)

  return (
    <TooltipProvider>
      <aside className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
        isCollapsed ? "w-16" : "w-60",
        className
      )}>
        {/* Header Section: ChuckBox Logo */}
        <div className={cn(
          "flex items-center border-b border-sidebar-border",
          isCollapsed ? "justify-center px-2 py-4" : "justify-center px-4 py-4"
        )}>
          <Link href="/" className="flex items-center justify-center">
            {isCollapsed ? (
              <Logo variant="icon" size="sm" />
            ) : (
              <div className="origin-center scale-[0.95]">
                <Logo variant="full" size="md" />
              </div>
            )}
          </Link>
        </div>

        {/* Unit Section - hidden when collapsed */}
        {!isCollapsed && (
          <div className="border-b border-sidebar-border px-4 py-4">
            <UnitSwitcher />
          </div>
        )}

        {/* Navigation Section */}
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <NavTooltip label={item.label} isCollapsed={isCollapsed}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isCollapsed ? "justify-center" : "gap-3",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && item.label}
                    </Link>
                  </NavTooltip>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Admin/Treasurer Settings Section */}
        {showSettings && (
          <div className="border-t border-sidebar-border px-2 py-3">
            <ul className="space-y-1">
              <li>
                <NavTooltip label="Settings" isCollapsed={isCollapsed}>
                  <Link
                    href="/settings"
                    className={cn(
                      "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isCollapsed ? "justify-center" : "gap-3",
                      pathname === '/settings' || pathname.startsWith('/settings/')
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <Settings className="h-4 w-4 shrink-0" />
                    {!isCollapsed && "Settings"}
                  </Link>
                </NavTooltip>
              </li>
            </ul>
          </div>
        )}

        {/* User Section - avatar links to profile */}
        <div className="border-t border-sidebar-border px-2 py-3">
          <NavTooltip label="Profile" isCollapsed={isCollapsed}>
            <Link
              href="/profile"
              className={cn(
                "flex items-center rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent/50",
                isCollapsed ? "justify-center" : "gap-3",
                pathname === '/profile' && "bg-sidebar-accent/50"
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <span className="text-sm font-medium">{initials}</span>
              </div>
              {!isCollapsed && (
                <span className="text-sm font-medium text-sidebar-foreground">
                  Profile
                </span>
              )}
            </Link>
          </NavTooltip>
          <NavTooltip label="Sign Out" isCollapsed={isCollapsed}>
            <a
              href="/logout"
              className={cn(
                "mt-1 flex items-center rounded-md px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20",
                isCollapsed ? "justify-center" : "gap-3"
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!isCollapsed && "Sign Out"}
            </a>
          </NavTooltip>
        </div>

        {/* Collapse Toggle Button */}
        <div className="border-t border-sidebar-border px-2 py-2">
          <NavTooltip label={isCollapsed ? "Expand" : "Collapse"} isCollapsed={isCollapsed}>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              className={cn(
                "w-full",
                isCollapsed ? "justify-center px-0" : "justify-start gap-3"
              )}
            >
              {isCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span>Collapse</span>
                </>
              )}
            </Button>
          </NavTooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
