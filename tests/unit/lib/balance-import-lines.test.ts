import { describe, it, expect } from 'vitest'
import { buildBalanceImportLines } from '@/lib/import/balance-import-lines'

const baseInput = {
  journalEntryId: 'entry-1',
  receivablesAccountId: 'recv-1',
  fundsLiabilityAccountId: 'funds-liab-1',
  openingBalanceAccountId: 'obe-1',
  scoutAccountId: 'scout-acct-1',
  currentBilling: 0,
  newBilling: 0,
  currentFunds: 0,
  newFunds: 0,
}

function totals(lines: Array<{ debit: number; credit: number }>) {
  return {
    debits: lines.reduce((s, l) => s + l.debit, 0),
    credits: lines.reduce((s, l) => s + l.credit, 0),
  }
}

describe('buildBalanceImportLines', () => {
  it('returns no lines when nothing changed', () => {
    expect(buildBalanceImportLines(baseInput)).toHaveLength(0)
  })

  it('balances a billing-only import (scout owes more) against opening balance equity', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      newBilling: -100, // scout now owes $100
    })

    expect(lines).toHaveLength(2)
    const receivable = lines.find((l) => l.account_id === 'recv-1')
    expect(receivable).toMatchObject({
      debit: 100,
      credit: 0,
      scout_account_id: 'scout-acct-1',
      target_balance: 'billing',
    })
    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra).toMatchObject({
      debit: 0,
      credit: 100,
      scout_account_id: null,
      target_balance: null,
    })

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('balances a billing decrease (less owed) with an opening-balance debit', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      currentBilling: -100,
      newBilling: -40,
    })

    const receivable = lines.find((l) => l.account_id === 'recv-1')
    expect(receivable).toMatchObject({ debit: 0, credit: 60 })
    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra).toMatchObject({ debit: 60, credit: 0 })

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('balances a funds-only import against opening balance equity', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      newFunds: 250,
    })

    expect(lines).toHaveLength(2)
    const liability = lines.find((l) => l.account_id === 'funds-liab-1')
    expect(liability).toMatchObject({
      debit: 0,
      credit: 250,
      scout_account_id: 'scout-acct-1',
      target_balance: 'funds',
    })
    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra).toMatchObject({ debit: 250, credit: 0 })

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('balances a funds decrease with an opening-balance credit', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      currentFunds: 80,
      newFunds: 30,
    })

    const liability = lines.find((l) => l.account_id === 'funds-liab-1')
    expect(liability).toMatchObject({ debit: 50, credit: 0 })
    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra).toMatchObject({ debit: 0, credit: 50 })

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('adds a single net contra when both balances change in the same direction', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      newBilling: -50, // debit 50
      newFunds: 75, // credit 75
    })

    expect(lines).toHaveLength(3)
    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra).toMatchObject({ debit: 25, credit: 0 })

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('omits the contra line when billing and funds changes offset exactly', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      newBilling: -50, // debit 50
      newFunds: 50, // credit 50
    })

    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.account_id === 'obe-1')).toBeUndefined()

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('rounds the contra amount to cents under float arithmetic', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      currentBilling: -0.1,
      newBilling: -0.3, // diff computed as 0.3 - 0.1 in floats
    })

    const contra = lines.find((l) => l.account_id === 'obe-1')
    expect(contra?.credit).toBe(0.2)

    const { debits, credits } = totals(lines)
    expect(debits).toBeCloseTo(credits, 2)
  })

  it('carries the journal entry id and balance memos on every line', () => {
    const lines = buildBalanceImportLines({
      ...baseInput,
      newBilling: -25,
    })

    for (const line of lines) {
      expect(line.journal_entry_id).toBe('entry-1')
    }
    const receivable = lines.find((l) => l.account_id === 'recv-1')
    expect(receivable?.memo).toBe('Billing balance: 0 → -25')
  })
})
