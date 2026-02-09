// Role-based access control utilities for Chuckbox

import {
  LayoutDashboard,
  Users,
  Wallet,
  Award,
  type LucideIcon,
} from 'lucide-react'

export type MemberRole = 'admin' | 'treasurer' | 'leader' | 'parent' | 'scout'

// Pages in the application
export type AppPage =
  | 'dashboard'
  | 'scouts'
  | 'accounts'
  | 'billing'
  | 'payments'
  | 'reports'
  | 'finances'
  | 'advancement'

// Actions that can be performed
export type AppAction =
  | 'manage_scouts'      // Add/edit/delete scouts
  | 'delete_scouts'      // Delete scouts (more restricted)
  | 'manage_billing'     // Create/edit billing records
  | 'delete_billing'     // Delete billing records
  | 'edit_billing'       // Edit billing record description
  | 'void_billing'       // Void billing charges
  | 'record_payments'    // Record new payments
  | 'void_payments'      // Void existing payments
  | 'manage_members'     // Invite/remove/change roles
  | 'view_all_accounts'  // View all scout accounts
  | 'adjust_accounts'    // Make manual account adjustments
  | 'export_reports'     // Export report data

// Page access by role
const PAGE_ACCESS: Record<AppPage, MemberRole[]> = {
  dashboard: ['admin', 'treasurer', 'leader'], // Parents/scouts redirected to Roster
  scouts: ['admin', 'treasurer', 'leader', 'parent', 'scout'], // Parent/Scout see filtered view
  accounts: ['admin', 'treasurer', 'leader', 'parent', 'scout'], // Kept for backwards compat
  billing: ['admin', 'treasurer'],
  payments: ['admin', 'treasurer'],
  reports: ['admin', 'treasurer', 'leader'],
  finances: ['admin', 'treasurer'], // Only financial roles can access
  advancement: ['admin', 'treasurer', 'leader'], // Feature flag controlled
}

// Action permissions by role
const ACTION_ACCESS: Record<AppAction, MemberRole[]> = {
  manage_scouts: ['admin', 'treasurer', 'leader'],
  delete_scouts: ['admin'],
  manage_billing: ['admin', 'treasurer'],
  delete_billing: ['admin'],
  edit_billing: ['admin', 'treasurer'],
  void_billing: ['admin', 'treasurer'],
  record_payments: ['admin', 'treasurer'],
  void_payments: ['admin'],
  manage_members: ['admin'],
  view_all_accounts: ['admin', 'treasurer', 'leader'],
  adjust_accounts: ['admin', 'treasurer'],
  export_reports: ['admin', 'treasurer', 'leader'],
}

// Navigation item type
export interface NavItem {
  href: string
  label: string
  page: AppPage
  icon: LucideIcon
}

// Navigation items with their required pages and icons
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', page: 'dashboard', icon: LayoutDashboard },
  { href: '/roster', label: 'Roster', page: 'scouts', icon: Users },
  { href: '/finances', label: 'Finances', page: 'finances', icon: Wallet },
  { href: '/advancement', label: 'Advancement', page: 'advancement', icon: Award },
]

/**
 * Check if a role can access a specific page
 */
export function canAccessPage(role: MemberRole | string, page: AppPage): boolean {
  const allowedRoles = PAGE_ACCESS[page]
  return allowedRoles.includes(role as MemberRole)
}

/**
 * Check if a role can perform a specific action
 */
export function canPerformAction(role: MemberRole | string, action: AppAction): boolean {
  const allowedRoles = ACTION_ACCESS[action]
  return allowedRoles.includes(role as MemberRole)
}

/**
 * Get navigation items visible to a specific role
 */
export function getVisibleNavItems(role: MemberRole | string): NavItem[] {
  return NAV_ITEMS.filter(item => canAccessPage(role, item.page))
}

/**
 * Check if role is a financial role (admin or treasurer)
 */
export function isFinancialRole(role: MemberRole | string): boolean {
  return role === 'admin' || role === 'treasurer'
}

/**
 * Check if role is a management role (admin, treasurer, or leader)
 */
export function isManagementRole(role: MemberRole | string): boolean {
  return role === 'admin' || role === 'treasurer' || role === 'leader'
}

/**
 * Check if role has limited/filtered view (parent or scout)
 */
export function hasFilteredView(role: MemberRole | string): boolean {
  return role === 'parent' || role === 'scout'
}

/**
 * Check if role is admin
 */
export function isAdmin(role: MemberRole | string): boolean {
  return role === 'admin'
}

/**
 * Check if role is treasurer
 */
export function isTreasurer(role: MemberRole | string): boolean {
  return role === 'treasurer'
}
