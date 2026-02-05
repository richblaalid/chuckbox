/**
 * Extension Authentication Helpers
 *
 * Handles token generation and validation for the Chuckbox browser extension.
 * Tokens are hashed with SHA-256 before storage for security.
 */

import { createHash, randomBytes } from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

// Type for the extension_auth_tokens table (not yet in generated types)
// Run `npm run db:types` after migration to remove this
type ExtensionAuthToken = {
  id: string
  profile_id: string
  unit_id: string
  token_hash: string
  expires_at: string
  created_at: string | null
  last_used_at: string | null
  is_revoked: boolean | null
}

const TOKEN_EXPIRY_DAYS = 60

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Helper for extension_auth_tokens table access
function getTokensTable(supabase: SupabaseClient<Database>) {
  return supabase.from('extension_auth_tokens')
}

/**
 * Create a new extension auth token for a user/unit
 *
 * @param supabase - Supabase client
 * @param profileId - User's profile ID
 * @param unitId - Unit ID the token is for
 * @returns The plain-text token (only shown once)
 */
export async function createExtensionToken(
  supabase: SupabaseClient<Database>,
  profileId: string,
  unitId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  // Revoke any existing active tokens for this user/unit
  await getTokensTable(supabase)
    .update({ is_revoked: true })
    .eq('profile_id', profileId)
    .eq('unit_id', unitId)
    .eq('is_revoked', false)

  // Create the new token
  const { error } = await getTokensTable(supabase).insert({
    profile_id: profileId,
    unit_id: unitId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    throw new Error(`Failed to create extension token: ${error.message}`)
  }

  return { token, expiresAt }
}

/**
 * Validate an extension auth token
 *
 * @param supabase - Supabase client (should be service role for token lookup)
 * @param token - The plain-text token to validate
 * @returns The profile and unit IDs if valid, null if invalid
 */
export async function validateExtensionToken(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<{ profileId: string; unitId: string } | null> {
  const tokenHash = hashToken(token)

  const { data, error } = await getTokensTable(supabase)
    .select('profile_id, unit_id, expires_at, is_revoked')
    .eq('token_hash', tokenHash)
    .single() as { data: ExtensionAuthToken | null; error: Error | null }

  if (error || !data) {
    return null
  }

  // Check if token is expired or revoked
  if (data.is_revoked || new Date(data.expires_at) < new Date()) {
    return null
  }

  // Update last_used_at
  await getTokensTable(supabase)
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)

  return {
    profileId: data.profile_id,
    unitId: data.unit_id,
  }
}

/**
 * Revoke an extension token by ID
 */
export async function revokeExtensionToken(
  supabase: SupabaseClient<Database>,
  tokenId: string,
  profileId: string
): Promise<void> {
  const { error } = await getTokensTable(supabase)
    .update({ is_revoked: true })
    .eq('id', tokenId)
    .eq('profile_id', profileId)

  if (error) {
    throw new Error(`Failed to revoke token: ${error.message}`)
  }
}

/**
 * Get active tokens for a user
 */
export async function getActiveTokens(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<Array<{
  id: string
  unitId: string
  expiresAt: Date
  createdAt: Date
  lastUsedAt: Date | null
}>> {
  const { data, error } = await getTokensTable(supabase)
    .select('id, unit_id, expires_at, created_at, last_used_at')
    .eq('profile_id', profileId)
    .eq('is_revoked', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }) as { data: ExtensionAuthToken[] | null; error: Error | null }

  if (error) {
    throw new Error(`Failed to get tokens: ${error.message}`)
  }

  return (data || []).map((t) => ({
    id: t.id,
    unitId: t.unit_id,
    expiresAt: new Date(t.expires_at),
    createdAt: new Date(t.created_at!),
    lastUsedAt: t.last_used_at ? new Date(t.last_used_at) : null,
  }))
}
