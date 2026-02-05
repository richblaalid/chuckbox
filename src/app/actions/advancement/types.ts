/**
 * Shared types for advancement module
 */

/**
 * Standard result type for server actions
 * @template T - The type of data returned on success
 */
export interface ActionResult<T = void> {
  success: boolean
  error?: string
  data?: T
}

/**
 * Result from leader role verification
 */
export interface LeaderAuthResult {
  profileId: string
  role: string
  fullName: string
}

/**
 * Error result from auth verification
 */
export interface AuthError {
  error: string
}

/**
 * Result from parent access verification
 */
export interface ParentAuthResult {
  profileId: string
}

/**
 * Type guard for auth errors
 */
export function isAuthError(result: LeaderAuthResult | AuthError | ParentAuthResult): result is AuthError {
  return 'error' in result
}
