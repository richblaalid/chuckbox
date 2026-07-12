/**
 * Integration tests for the journal balance invariant (CHUCK-9)
 *
 * Proves the deferred constraint trigger journal_entry_balance_check enforces
 * Σdebit = Σcredit per journal entry at commit — unbalanced writes are
 * rejected, balanced writes and the entry-then-lines pattern keep working —
 * and that the repaired writers produce balanced entries:
 *   - process_payment_link_payment in both fee modes (PLATFORM-023)
 *   - the balance-import line shape incl. the Opening Balance Equity contra
 *     (PLATFORM-022)
 *
 * Uses a real Supabase connection (dev DB); skipped when the integration
 * environment is not configured (same pattern as rpc-authz.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestClient,
  isIntegrationTestEnvironment,
  TestContext,
} from './setup'
import { seedUnit, seedScout } from './seed'
import { buildBalanceImportLines } from '@/lib/import/balance-import-lines'
import type { Database } from '@/types/database'

const describeIntegration = isIntegrationTestEnvironment() ? describe : describe.skip

type AccountsByCode = Record<string, string>

// Default chart-of-accounts codes the tests reference (asset, AR, funds
// liability, opening-balance equity, and merchant-fee expense).
const REQUIRED_ACCOUNT_CODES = ['1000', '1100', '1200', '2100', '3000', '5600']

async function fetchLineTotals(
  service: SupabaseClient<Database>,
  journalEntryId: string
) {
  const { data: lines, error } = await service
    .from('journal_lines')
    .select('account_id, debit, credit, memo')
    .eq('journal_entry_id', journalEntryId)
  if (error) throw new Error(`Failed to fetch journal lines: ${error.message}`)
  const debits = (lines || []).reduce((s, l) => s + Number(l.debit || 0), 0)
  const credits = (lines || []).reduce((s, l) => s + Number(l.credit || 0), 0)
  return { lines: lines || [], debits, credits }
}

describeIntegration('journal balance invariant (CHUCK-9)', () => {
  let service: SupabaseClient<Database>
  let ctx: TestContext
  let unitId: string
  let scoutAccountId: string
  let accounts: AccountsByCode

  async function createScratchEntry(description: string): Promise<string> {
    const { data, error } = await service
      .from('journal_entries')
      .insert({
        unit_id: unitId,
        entry_date: '2026-07-12',
        description,
        entry_type: 'adjustment',
        is_posted: false,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Entry insert failed: ${error?.message}`)
    return data.id
  }

  async function seedPaymentLink(options: {
    amountCents: number
    baseAmountCents: number
    feeAmountCents: number
    feesPassedToPayer: boolean
  }): Promise<{ id: string }> {
    const token = `chuck9test${Math.random().toString(16).slice(2)}`.padEnd(64, '0')
    const { data, error } = await service
      .from('payment_links')
      .insert({
        unit_id: unitId,
        scout_account_id: scoutAccountId,
        amount: options.amountCents,
        base_amount: options.baseAmountCents,
        fee_amount: options.feeAmountCents,
        fees_passed_to_payer: options.feesPassedToPayer,
        description: 'CHUCK-9 integration test link',
        token,
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Payment link seed failed: ${error?.message}`)
    return data
  }

  async function setBillingBalance(balance: number): Promise<void> {
    const { error } = await service
      .from('scout_accounts')
      .update({ billing_balance: balance, funds_balance: 0 })
      .eq('id', scoutAccountId)
    if (error) throw new Error(`Failed to set billing balance: ${error.message}`)
  }

  beforeAll(async () => {
    service = createTestClient()
    ctx = new TestContext(service)

    const unit = await seedUnit(service, ctx, { name: 'CHUCK-9 Balance Unit' })
    unitId = unit.id

    const scout = await seedScout(service, ctx, unitId, {
      firstName: 'Journal',
      lastName: 'Balance',
    })

    const { data: account } = await service
      .from('scout_accounts')
      .select('id')
      .eq('scout_id', scout.id)
      .single()
    if (!account) throw new Error('Scout account not created by trigger')
    scoutAccountId = account.id

    const { data: accountRows } = await service
      .from('accounts')
      .select('id, code')
      .eq('unit_id', unitId)
      .in('code', REQUIRED_ACCOUNT_CODES)
    accounts = Object.fromEntries((accountRows || []).map((a) => [a.code, a.id]))
    for (const code of REQUIRED_ACCOUNT_CODES) {
      if (!accounts[code]) throw new Error(`Default account ${code} missing for test unit`)
    }
  }, 60000)

  afterAll(async () => {
    // Finance rows RESTRICT unit deletion — remove them in FK order first
    await service.from('square_transactions').delete().eq('unit_id', unitId)
    await service.from('payment_links').delete().eq('unit_id', unitId)
    await service.from('payments').delete().eq('unit_id', unitId)
    await service.from('journal_entries').delete().eq('unit_id', unitId)
    await ctx.cleanup()
  }, 60000)

  // --- Constraint behavior ---

  it('rejects an unbalanced journal_lines insert at commit', async () => {
    const entryId = await createScratchEntry('CHUCK-9 unbalanced insert test')

    const { error } = await service.from('journal_lines').insert([
      {
        journal_entry_id: entryId,
        account_id: accounts['1000'],
        debit: 25,
        credit: 0,
        memo: 'unbalanced test line',
      },
    ])

    expect(error).not.toBeNull()
    expect(error?.message).toContain('unbalanced')

    await service.from('journal_entries').delete().eq('id', entryId)
  })

  it('accepts a balanced journal_lines insert and a full-entry delete', async () => {
    const entryId = await createScratchEntry('CHUCK-9 balanced insert test')

    const { error } = await service.from('journal_lines').insert([
      {
        journal_entry_id: entryId,
        account_id: accounts['1000'],
        debit: 25,
        credit: 0,
        memo: 'balanced test line',
      },
      {
        journal_entry_id: entryId,
        account_id: accounts['1100'],
        debit: 0,
        credit: 25,
        memo: 'balanced test line',
      },
    ])
    expect(error).toBeNull()

    // Deleting the whole entry (cascade removes every line) stays legal
    const { error: deleteError } = await service
      .from('journal_entries')
      .delete()
      .eq('id', entryId)
    expect(deleteError).toBeNull()
  })

  it('rejects a partial line delete that would unbalance the entry', async () => {
    const entryId = await createScratchEntry('CHUCK-9 partial delete test')

    await service.from('journal_lines').insert([
      {
        journal_entry_id: entryId,
        account_id: accounts['1000'],
        debit: 10,
        credit: 0,
        memo: 'partial delete test',
      },
      {
        journal_entry_id: entryId,
        account_id: accounts['1100'],
        debit: 0,
        credit: 10,
        memo: 'partial delete test',
      },
    ])

    const { data: lines } = await service
      .from('journal_lines')
      .select('id')
      .eq('journal_entry_id', entryId)
    expect(lines?.length).toBe(2)

    const { error } = await service
      .from('journal_lines')
      .delete()
      .eq('id', lines![0].id)
    expect(error).not.toBeNull()
    expect(error?.message).toContain('unbalanced')

    await service.from('journal_entries').delete().eq('id', entryId)
  })

  // --- process_payment_link_payment (both fee modes) ---

  it('produces a balanced entry when fees are absorbed by the unit', async () => {
    await setBillingBalance(-200)
    const baseCents = 10000 // $100.00
    const squareFeeCents = 270 // 2.6% + $0.10 on $100
    const link = await seedPaymentLink({
      amountCents: baseCents,
      baseAmountCents: baseCents,
      feeAmountCents: 0,
      feesPassedToPayer: false,
    })

    const { data, error } = await service.rpc('process_payment_link_payment', {
      p_payment_link_id: link.id,
      p_scout_account_id: scoutAccountId,
      p_base_amount_cents: baseCents,
      p_total_amount_cents: baseCents,
      p_fee_amount_cents: squareFeeCents,
      p_net_amount_cents: baseCents - squareFeeCents,
      p_square_payment_id: `chuck9-absorbed-${Date.now()}`,
      p_square_receipt_url: '',
      p_square_order_id: '',
      p_scout_name: 'Journal Balance',
      p_fees_passed_to_payer: false,
      p_card_details: { card_brand: 'VISA', last_4: '1111', cardholder_name: null },
    })

    expect(error).toBeNull()
    const result = data as { success: boolean; journal_entry_id: string }
    expect(result.success).toBe(true)

    const { lines, debits, credits } = await fetchLineTotals(service, result.journal_entry_id)
    expect(debits).toBeCloseTo(credits, 2)
    expect(debits).toBeCloseTo(100.0, 2)
    const feeLine = lines.find((l) => l.account_id === accounts['5600'] && Number(l.debit) > 0)
    expect(Number(feeLine?.debit)).toBeCloseTo(2.7, 2)
  })

  it('produces a balanced entry with the surcharge credit when fees are passed to the payer', async () => {
    await setBillingBalance(-200)
    const baseCents = 10000 // $100.00 bill
    const surchargeCents = 270 // unit-configured fee added on top
    const totalCents = baseCents + surchargeCents // charged to the card
    const squareFeeCents = 277 // Square's fee on the total
    const link = await seedPaymentLink({
      amountCents: totalCents,
      baseAmountCents: baseCents,
      feeAmountCents: surchargeCents,
      feesPassedToPayer: true,
    })

    const { data, error } = await service.rpc('process_payment_link_payment', {
      p_payment_link_id: link.id,
      p_scout_account_id: scoutAccountId,
      p_base_amount_cents: baseCents,
      p_total_amount_cents: totalCents,
      p_fee_amount_cents: squareFeeCents,
      p_net_amount_cents: totalCents - squareFeeCents,
      p_square_payment_id: `chuck9-passed-${Date.now()}`,
      p_square_receipt_url: '',
      p_square_order_id: '',
      p_scout_name: 'Journal Balance',
      p_fees_passed_to_payer: true,
      p_card_details: { card_brand: 'VISA', last_4: '1111', cardholder_name: null },
    })

    expect(error).toBeNull()
    const result = data as { success: boolean; journal_entry_id: string }
    expect(result.success).toBe(true)

    const { lines, debits, credits } = await fetchLineTotals(service, result.journal_entry_id)
    expect(debits).toBeCloseTo(credits, 2)
    expect(debits).toBeCloseTo(102.7, 2) // gross charged to the card

    // AR credited by base only; the payer's surcharge offsets the fee expense
    const arLine = lines.find((l) => l.account_id === accounts['1200'])
    expect(Number(arLine?.credit)).toBeCloseTo(100.0, 2)
    const surchargeLine = lines.find(
      (l) => l.account_id === accounts['5600'] && Number(l.credit) > 0
    )
    expect(Number(surchargeLine?.credit)).toBeCloseTo(2.7, 2)
    const feeLine = lines.find(
      (l) => l.account_id === accounts['5600'] && Number(l.debit) > 0
    )
    expect(Number(feeLine?.debit)).toBeCloseTo(2.77, 2)
  })

  // --- Balance-import line shape (PLATFORM-022) ---

  it('accepts the balance-import line shape with its Opening Balance Equity contra', async () => {
    const entryId = await createScratchEntry('CHUCK-9 import shape test')

    const lines = buildBalanceImportLines({
      journalEntryId: entryId,
      receivablesAccountId: accounts['1100'],
      fundsLiabilityAccountId: accounts['2100'],
      openingBalanceAccountId: accounts['3000'],
      scoutAccountId,
      currentBilling: 0,
      newBilling: -50, // scout owes $50
      currentFunds: 0,
      newFunds: 25, // scout has $25 savings
    })
    expect(lines.length).toBe(3)

    const { error } = await service.from('journal_lines').insert(lines)
    expect(error).toBeNull()

    const { debits, credits } = await fetchLineTotals(service, entryId)
    expect(debits).toBeCloseTo(credits, 2)

    await service.from('journal_entries').delete().eq('id', entryId)
  })
})
