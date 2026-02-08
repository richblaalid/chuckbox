import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { encrypt, decrypt } from '../encryption'
import { createClient } from '../supabase/server'
import { createAdminClient } from '../supabase/admin'
import type { Database } from '@/types/database'

type PlaidConnection = Database['public']['Tables']['plaid_connections']['Row']

// Environment configuration
export type PlaidEnv = 'sandbox' | 'development' | 'production'

export function getPlaidEnvironment(): PlaidEnv {
  const env = process.env.PLAID_ENVIRONMENT || 'sandbox'
  if (env === 'production' || env === 'development' || env === 'sandbox') {
    return env
  }
  return 'sandbox'
}

function getPlaidBasePath(): string {
  const env = getPlaidEnvironment()
  switch (env) {
    case 'production':
      return PlaidEnvironments.production
    case 'development':
      return PlaidEnvironments.development
    default:
      return PlaidEnvironments.sandbox
  }
}

export function getPlaidClientId(): string {
  const clientId = process.env.PLAID_CLIENT_ID
  if (!clientId) {
    throw new Error('PLAID_CLIENT_ID environment variable is not set')
  }
  return clientId
}

export function getPlaidSecret(): string {
  const secret = process.env.PLAID_SECRET
  if (!secret) {
    throw new Error('PLAID_SECRET environment variable is not set')
  }
  return secret
}

// Create a Plaid API client for server-side operations
export function createPlaidClient(): PlaidApi {
  const configuration = new Configuration({
    basePath: getPlaidBasePath(),
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': getPlaidClientId(),
        'PLAID-SECRET': getPlaidSecret(),
      },
    },
  })

  return new PlaidApi(configuration)
}

// Get Plaid connection for a unit
export async function getUnitPlaidConnection(
  unitId: string
): Promise<PlaidConnection | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('plaid_connections')
    .select('*')
    .eq('unit_id', unitId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data
}

// Get decrypted access token for API calls
export async function getPlaidAccessToken(unitId: string): Promise<string | null> {
  const connection = await getUnitPlaidConnection(unitId)
  if (!connection) {
    return null
  }

  try {
    return decrypt(connection.access_token)
  } catch {
    // Token may be corrupted or encryption key changed
    await updateConnectionStatus(unitId, 'error', 'DECRYPTION_ERROR', 'Failed to decrypt access token')
    return null
  }
}

// Create a Link Token for Plaid Link initialization
export async function createLinkToken(
  unitId: string,
  profileId: string
): Promise<string> {
  const client = createPlaidClient()

  const response = await client.linkTokenCreate({
    user: {
      client_user_id: profileId,
    },
    client_name: 'Chuckbox',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    // Webhook for receiving updates (optional, can be added later)
    // webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/plaid/webhook`,
  })

  return response.data.link_token
}

// Exchange public token for access token after Link success
export async function exchangePublicToken(
  unitId: string,
  publicToken: string,
  institutionId: string,
  institutionName: string,
  accounts: Array<{
    id: string
    name: string
    mask: string | null
    type: string
    subtype: string | null
  }>
): Promise<PlaidConnection> {
  const client = createPlaidClient()

  // Exchange public token for access token
  const exchangeResponse = await client.itemPublicTokenExchange({
    public_token: publicToken,
  })

  const { access_token, item_id } = exchangeResponse.data

  // Encrypt the access token before storage
  const encryptedAccessToken = encrypt(access_token)

  // Store the connection using admin client to bypass RLS
  const adminSupabase = createAdminClient()

  const { data, error } = await adminSupabase
    .from('plaid_connections')
    .upsert(
      {
        unit_id: unitId,
        item_id,
        access_token: encryptedAccessToken,
        institution_id: institutionId,
        institution_name: institutionName,
        accounts: accounts.map((a) => ({
          account_id: a.id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
        })),
        status: 'active',
        error_code: null,
        error_message: null,
        last_synced_at: new Date().toISOString(),
      },
      {
        onConflict: 'unit_id',
      }
    )
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to save Plaid connection: ${error?.message || 'Unknown error'}`)
  }

  return data
}

// Fetch accounts from Plaid and update cached data
export async function syncPlaidAccounts(unitId: string): Promise<PlaidConnection | null> {
  const connection = await getUnitPlaidConnection(unitId)
  if (!connection) {
    return null
  }

  const client = createPlaidClient()

  try {
    const accessToken = decrypt(connection.access_token)

    // Get updated account information
    const accountsResponse = await client.accountsGet({
      access_token: accessToken,
    })

    // Get account balances
    const accounts = accountsResponse.data.accounts.map((a) => ({
      account_id: a.account_id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balance: {
        available: a.balances.available,
        current: a.balances.current,
        limit: a.balances.limit,
        currency: a.balances.iso_currency_code || 'USD',
      },
    }))

    // Update cached accounts
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('plaid_connections')
      .update({
        accounts,
        last_synced_at: new Date().toISOString(),
        status: 'active',
        error_code: null,
        error_message: null,
      })
      .eq('unit_id', unitId)
      .select()
      .single()

    if (error || !data) {
      throw new Error(`Failed to update accounts: ${error?.message}`)
    }

    return data
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    // Check for Plaid-specific errors
    if (errorMessage.includes('ITEM_LOGIN_REQUIRED')) {
      await updateConnectionStatus(unitId, 'error', 'ITEM_LOGIN_REQUIRED', 'Bank login credentials need to be updated')
    } else {
      await updateConnectionStatus(unitId, 'error', 'SYNC_ERROR', errorMessage)
    }

    return null
  }
}

// Update connection status (for error handling)
async function updateConnectionStatus(
  unitId: string,
  status: 'active' | 'error' | 'disconnected',
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  const supabase = await createClient()

  await supabase
    .from('plaid_connections')
    .update({
      status,
      error_code: errorCode || null,
      error_message: errorMessage || null,
    })
    .eq('unit_id', unitId)
}

// Disconnect Plaid (remove access token from Plaid and database)
export async function disconnectPlaid(unitId: string): Promise<void> {
  const connection = await getUnitPlaidConnection(unitId)

  if (connection) {
    const client = createPlaidClient()

    try {
      const accessToken = decrypt(connection.access_token)
      // Remove the Item from Plaid
      await client.itemRemove({
        access_token: accessToken,
      })
    } catch {
      // Token may already be invalid, continue with disconnect
    }
  }

  // Delete the connection from database
  const supabase = await createClient()
  const { error } = await supabase
    .from('plaid_connections')
    .delete()
    .eq('unit_id', unitId)

  if (error) {
    throw new Error(`Failed to disconnect Plaid: ${error.message}`)
  }
}

// Get transactions for a date range (read-only feature)
export async function getPlaidTransactions(
  unitId: string,
  startDate: string,
  endDate: string
) {
  const accessToken = await getPlaidAccessToken(unitId)
  if (!accessToken) {
    return null
  }

  const client = createPlaidClient()

  const response = await client.transactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
  })

  return {
    accounts: response.data.accounts,
    transactions: response.data.transactions,
    totalTransactions: response.data.total_transactions,
  }
}
