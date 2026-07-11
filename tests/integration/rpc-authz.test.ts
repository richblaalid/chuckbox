/**
 * Integration Tests for money-moving RPC authorization (CHUCK-7)
 *
 * Proves the SECURITY DEFINER RPCs transfer_funds_to_billing,
 * auto_transfer_overpayment, and void_payment reject callers without
 * admin/treasurer membership in the affected unit (including admins of a
 * DIFFERENT unit), while the legitimate caller shapes — unit treasurer,
 * guardian of the scout (transfer only), and the service-role client —
 * still pass.
 *
 * Uses a real Supabase connection (dev DB); skipped when the integration
 * environment is not configured (same pattern as advancement.test.ts).
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
const TEST_PASSWORD = 'rpc-authz-integration-pw-1'

const describeIntegration =
  isIntegrationTestEnvironment() && ANON_KEY ? describe : describe.skip

interface TestUser {
  userId: string
  profileId: string
  email: string
}

describeIntegration('RPC authorization (CHUCK-7)', () => {
  let service: SupabaseClient<Database>
  let ctx: TestContext

  let unitA: { id: string } // victim unit
  let unitB: { id: string } // attacker's unit
  let scoutAccountId: string

  let attackerAdminB: TestUser // admin of unit B — no membership in unit A
  let parentA: TestUser // parent in unit A, NOT a guardian of the scout
  let guardianA: TestUser // parent in unit A, guardian of the scout
  let treasurerA: TestUser // treasurer in unit A

  let attackerClient: SupabaseClient<Database>
  let parentClient: SupabaseClient<Database>
  let guardianClient: SupabaseClient<Database>
  let treasurerClient: SupabaseClient<Database>

  let rejectionPaymentId: string
  let voidablePaymentId: string

  async function createUser(suffix: string): Promise<TestUser> {
    const email = `rpc-authz-${suffix}-${Date.now()}@example.com`
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

  async function addMembership(user: TestUser, unitId: string, role: 'admin' | 'treasurer' | 'parent') {
    const { error } = await service.from('unit_memberships').insert({
      unit_id: unitId,
      profile_id: user.profileId,
      role,
      status: 'active',
    })
    if (error) throw new Error(`Membership insert failed: ${error.message}`)
  }

  async function seedCashPayment(): Promise<string> {
    const { data, error } = await service
      .from('payments')
      .insert({
        unit_id: unitA.id,
        scout_account_id: null,
        amount: 10,
        fee_amount: 0,
        net_amount: 10,
        payment_method: 'cash',
        status: 'completed',
        notes: 'CHUCK-7 rpc-authz integration test payment',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Payment seed failed: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    service = createTestClient()
    ctx = new TestContext(service)

    unitA = await seedUnit(service, ctx, { name: 'RPC Authz Victim Unit' })
    unitB = await seedUnit(service, ctx, { name: 'RPC Authz Attacker Unit' })

    const scout = await seedScout(service, ctx, unitA.id, {
      firstName: 'Authz',
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

    // Give the scout a funds balance via a balanced fundraising journal entry
    // (mirrors credit_fundraising_to_scout; balance triggers maintain funds_balance)
    const { data: accounts, error: accountsError } = await service
      .from('accounts')
      .select('id, code')
      .eq('unit_id', unitA.id)
      .in('code', ['1210', '4900'])
    if (accountsError || !accounts || accounts.length < 2) {
      throw new Error(`Default accounts missing: ${accountsError?.message}`)
    }
    const fundsAccountId = accounts.find((a) => a.code === '1210')!.id
    const incomeAccountId = accounts.find((a) => a.code === '4900')!.id

    const { data: entry, error: entryError } = await service
      .from('journal_entries')
      .insert({
        unit_id: unitA.id,
        entry_date: new Date().toISOString().slice(0, 10),
        description: 'CHUCK-7 rpc-authz test funds seed',
        entry_type: 'fundraising_credit',
        is_posted: true,
      })
      .select('id')
      .single()
    if (entryError || !entry) throw new Error(`Journal seed failed: ${entryError?.message}`)

    const { error: linesError } = await service.from('journal_lines').insert([
      {
        journal_entry_id: entry.id,
        account_id: fundsAccountId,
        scout_account_id: scoutAccountId,
        debit: 0,
        credit: 100,
        memo: 'test funds seed',
        target_balance: 'funds',
      },
      {
        journal_entry_id: entry.id,
        account_id: incomeAccountId,
        scout_account_id: null,
        debit: 100,
        credit: 0,
        memo: 'test funds seed offset',
        target_balance: null,
      },
    ])
    if (linesError) throw new Error(`Journal lines seed failed: ${linesError.message}`)

    // Users + memberships
    attackerAdminB = await createUser('attacker-admin')
    parentA = await createUser('parent')
    guardianA = await createUser('guardian')
    treasurerA = await createUser('treasurer')

    await addMembership(attackerAdminB, unitB.id, 'admin')
    await addMembership(parentA, unitA.id, 'parent')
    await addMembership(guardianA, unitA.id, 'parent')
    await addMembership(treasurerA, unitA.id, 'treasurer')

    const { error: guardianError } = await service.from('scout_guardians').insert({
      scout_id: scout.id,
      profile_id: guardianA.profileId,
      relationship: 'parent',
    })
    if (guardianError) throw new Error(`Guardian insert failed: ${guardianError.message}`)

    rejectionPaymentId = await seedCashPayment()
    voidablePaymentId = await seedCashPayment()

    attackerClient = await signIn(attackerAdminB)
    parentClient = await signIn(parentA)
    guardianClient = await signIn(guardianA)
    treasurerClient = await signIn(treasurerA)
  }, 120_000)

  afterAll(async () => {
    if (!service) return
    const unitIds = [unitA?.id, unitB?.id].filter(Boolean) as string[]
    const profileIds = [attackerAdminB, parentA, guardianA, treasurerA]
      .filter(Boolean)
      .map((u) => u.profileId)

    // Payments first (FK to profiles via voided_by)
    if (unitIds.length) {
      await service.from('payments').delete().in('unit_id', unitIds)

      // Journal lines before entries (line-delete triggers reverse balances)
      const { data: entries } = await service
        .from('journal_entries')
        .select('id')
        .in('unit_id', unitIds)
      const entryIds = entries?.map((e) => e.id) || []
      if (entryIds.length) {
        await service.from('journal_lines').delete().in('journal_entry_id', entryIds)
        await service.from('journal_entries').delete().in('id', entryIds)
      }
      await service.from('audit_log').delete().in('unit_id', unitIds)
    }

    await ctx.cleanup()

    // Audit rows written during cleanup reference profiles; clear before user delete
    if (profileIds.length) {
      await service.from('audit_log').delete().in('performed_by', profileIds)
    }
    for (const user of [attackerAdminB, parentA, guardianA, treasurerA]) {
      if (user?.userId) {
        await service.auth.admin.deleteUser(user.userId)
      }
    }
  }, 120_000)

  describe('transfer_funds_to_billing', () => {
    it('rejects an admin of a different unit (cross-unit attack)', async () => {
      const { data, error } = await attackerClient.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
        p_description: 'cross-unit attack attempt',
      })
      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('rejects a same-unit parent who is not a guardian of the scout', async () => {
      const { error } = await parentClient.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
        p_description: 'non-guardian parent attempt',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('allows a guardian of the scout (use-funds modal path)', async () => {
      const { data, error } = await guardianClient.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
        p_description: 'guardian transfer',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean }).success).toBe(true)
    }, 15_000)

    it('allows a treasurer of the unit (quick-payment form path)', async () => {
      const { data, error } = await treasurerClient.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
        p_description: 'treasurer transfer',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean }).success).toBe(true)
    }, 15_000)

    it('allows the service-role client (pay-with-balance route path)', async () => {
      const { data, error } = await service.rpc('transfer_funds_to_billing', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
        p_description: 'service-role transfer',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean }).success).toBe(true)
    }, 15_000)
  })

  describe('auto_transfer_overpayment', () => {
    it('rejects an admin of a different unit (cross-unit attack)', async () => {
      const { error } = await attackerClient.rpc('auto_transfer_overpayment', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('rejects a same-unit parent', async () => {
      const { error } = await parentClient.rpc('auto_transfer_overpayment', {
        p_scout_account_id: scoutAccountId,
        p_amount: 5,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('allows a treasurer of the unit', async () => {
      const { error } = await treasurerClient.rpc('auto_transfer_overpayment', {
        p_scout_account_id: scoutAccountId,
        p_amount: 1,
      })
      expect(error).toBeNull()
    }, 15_000)
  })

  describe('void_payment', () => {
    it('rejects an admin of a different unit (cross-unit attack)', async () => {
      const { error } = await attackerClient.rpc('void_payment', {
        p_payment_id: rejectionPaymentId,
        p_voided_by: attackerAdminB.profileId,
        p_reason: 'cross-unit void attempt',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('rejects a same-unit parent', async () => {
      const { error } = await parentClient.rpc('void_payment', {
        p_payment_id: rejectionPaymentId,
        p_voided_by: parentA.profileId,
        p_reason: 'parent void attempt',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    }, 15_000)

    it('allows a treasurer of the unit (voidPayment server-action path)', async () => {
      const { data, error } = await treasurerClient.rpc('void_payment', {
        p_payment_id: voidablePaymentId,
        p_voided_by: treasurerA.profileId,
        p_reason: 'treasurer void (integration test)',
      })
      expect(error).toBeNull()
      expect((data as { success: boolean }).success).toBe(true)
    }, 15_000)
  })
})
