/**
 * Integration Tests for anonymous payment_links exposure (CHUCK-8)
 *
 * Proves a client holding only the public anon key cannot read payment_links
 * — neither dumping the table nor filtering by an exact token — and cannot
 * read other sensitive tables the blanket anon grant used to expose. The
 * legitimate readers keep working: treasurer and guardian sessions (RLS
 * policies) and the service-role client (the /pay/[token] route path).
 *
 * Uses a real Supabase connection (dev DB); skipped when the integration
 * environment is not configured (same pattern as rpc-authz.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  createTestClient,
  isIntegrationTestEnvironment,
  TestContext,
} from './setup'
import { seedUnit, seedScout } from './seed'
import type { Database } from '@/types/database'

const SUPABASE_URL =
  process.env.TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TEST_PASSWORD = 'payment-links-anon-integration-pw-1'

const describeIntegration =
  isIntegrationTestEnvironment() && ANON_KEY ? describe : describe.skip

interface TestUser {
  userId: string
  profileId: string
  email: string
}

describeIntegration('payment_links anonymous exposure (CHUCK-8)', () => {
  let service: SupabaseClient<Database>
  let ctx: TestContext

  let unit: { id: string }
  let scoutAccountId: string
  let paymentLinkId: string
  let paymentLinkToken: string

  let treasurer: TestUser
  let guardian: TestUser

  let anonClient: SupabaseClient<Database>
  let treasurerClient: SupabaseClient<Database>
  let guardianClient: SupabaseClient<Database>

  async function createUser(suffix: string): Promise<TestUser> {
    const email = `pl-anon-${suffix}-${Date.now()}@example.com`
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`Failed to create test user ${suffix}: ${error?.message}`)
    }
    // handle_new_user trigger creates the profile row
    const { data: profile, error: profileError } = await service
      .from('profiles')
      .select('id')
      .eq('user_id', data.user.id)
      .single()
    if (profileError || !profile) {
      throw new Error(`Profile not created for ${suffix}: ${profileError?.message}`)
    }
    return { userId: data.user.id, profileId: profile.id, email }
  }

  async function signIn(user: TestUser): Promise<SupabaseClient<Database>> {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await client.auth.signInWithPassword({
      email: user.email,
      password: TEST_PASSWORD,
    })
    if (error) throw new Error(`Sign-in failed for ${user.email}: ${error.message}`)
    return client
  }

  beforeAll(async () => {
    service = createTestClient()
    ctx = new TestContext(service)

    unit = await seedUnit(service, ctx, { name: 'PL Anon Test Unit' })
    const scout = await seedScout(service, ctx, unit.id, {
      firstName: 'PlAnon',
      lastName: 'TestScout',
    })

    // trigger_create_scout_account created the account
    const { data: account, error: accountError } = await service
      .from('scout_accounts')
      .select('id')
      .eq('scout_id', scout.id)
      .single()
    if (accountError || !account) {
      throw new Error(`Scout account not found: ${accountError?.message}`)
    }
    scoutAccountId = account.id

    paymentLinkToken = `chuck8-anon-test-${Date.now()}`
    const { data: link, error: linkError } = await service
      .from('payment_links')
      .insert({
        unit_id: unit.id,
        scout_account_id: scoutAccountId,
        amount: 2500,
        base_amount: 2500,
        description: 'CHUCK-8 anon exposure test link',
        token: paymentLinkToken,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (linkError || !link) {
      throw new Error(`Payment link seed failed: ${linkError?.message}`)
    }
    paymentLinkId = link.id

    treasurer = await createUser('treasurer')
    guardian = await createUser('guardian')

    const { error: membershipError } = await service.from('unit_memberships').insert([
      { unit_id: unit.id, profile_id: treasurer.profileId, role: 'treasurer', status: 'active' },
      { unit_id: unit.id, profile_id: guardian.profileId, role: 'parent', status: 'active' },
    ])
    if (membershipError) {
      throw new Error(`Membership insert failed: ${membershipError.message}`)
    }

    const { error: guardianError } = await service.from('scout_guardians').insert({
      scout_id: scout.id,
      profile_id: guardian.profileId,
      relationship: 'parent',
    })
    if (guardianError) throw new Error(`Guardian insert failed: ${guardianError.message}`)

    anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    treasurerClient = await signIn(treasurer)
    guardianClient = await signIn(guardian)
  }, 120_000)

  afterAll(async () => {
    if (!service) return
    if (paymentLinkId) {
      await service.from('payment_links').delete().eq('id', paymentLinkId)
    }
    await ctx.cleanup()
    for (const user of [treasurer, guardian]) {
      if (user?.userId) {
        await service.auth.admin.deleteUser(user.userId)
      }
    }
  }, 120_000)

  describe('anon key gets nothing', () => {
    it('cannot dump payment_links (token harvesting)', async () => {
      const { data } = await anonClient.from('payment_links').select('*')
      expect(data ?? []).toHaveLength(0)
    }, 15_000)

    it('cannot read a payment link by its exact token', async () => {
      const { data } = await anonClient
        .from('payment_links')
        .select('*')
        .eq('token', paymentLinkToken)
      expect(data ?? []).toHaveLength(0)
    }, 15_000)

    it('cannot read other sensitive tables (blanket grant revoked)', async () => {
      for (const table of ['payments', 'scout_accounts', 'profiles'] as const) {
        const { data } = await anonClient.from(table).select('*').limit(1)
        expect(data ?? [], `anon read of ${table} leaked rows`).toHaveLength(0)
      }
    }, 15_000)

    it('cannot insert into payment_links', async () => {
      const { data, error } = await anonClient
        .from('payment_links')
        .insert({
          unit_id: unit.id,
          amount: 100,
          token: `chuck8-anon-write-${Date.now()}`,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        })
        .select('id')
      expect(data ?? []).toHaveLength(0)
      expect(error).not.toBeNull()
    }, 15_000)
  })

  describe('legitimate readers keep working', () => {
    it('treasurer session reads the unit payment link', async () => {
      const { data, error } = await treasurerClient
        .from('payment_links')
        .select('id, token')
        .eq('id', paymentLinkId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    }, 15_000)

    it("guardian session reads their scout's payment link", async () => {
      const { data, error } = await guardianClient
        .from('payment_links')
        .select('id, token')
        .eq('id', paymentLinkId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    }, 15_000)

    it('service-role client resolves the link by token (/pay/[token] route path)', async () => {
      const { data, error } = await service
        .from('payment_links')
        .select('id, amount, status')
        .eq('token', paymentLinkToken)
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBe(paymentLinkId)
    }, 15_000)
  })
})
