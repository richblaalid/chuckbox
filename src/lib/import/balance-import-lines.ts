/**
 * Journal-line construction for balance imports (set/adjust modes).
 *
 * A balance import states scout balances without a real counterparty, so the
 * scout-facing lines are balanced against the unit's Opening Balance Equity
 * account (code 3000) — the standard treatment for imported opening balances.
 * Every returned line set satisfies Σdebit = Σcredit, which the DB enforces
 * via the journal_entry_balance constraint trigger.
 */

export interface BalanceImportLine {
  journal_entry_id: string
  account_id: string
  scout_account_id: string | null
  debit: number
  credit: number
  memo: string
  target_balance: string | null
}

export interface BalanceImportLineInput {
  journalEntryId: string
  receivablesAccountId: string
  fundsLiabilityAccountId: string
  openingBalanceAccountId: string
  scoutAccountId: string
  currentBilling: number
  newBilling: number
  currentFunds: number
  newFunds: number
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function buildBalanceImportLines(
  input: BalanceImportLineInput
): BalanceImportLine[] {
  const billingDiff = roundToCents(input.newBilling - input.currentBilling)
  const fundsDiff = roundToCents(input.newFunds - input.currentFunds)

  const lines: BalanceImportLine[] = []

  if (billingDiff !== 0) {
    // More owed (billing goes more negative) = debit receivables; less owed = credit
    lines.push({
      journal_entry_id: input.journalEntryId,
      account_id: input.receivablesAccountId,
      scout_account_id: input.scoutAccountId,
      debit: billingDiff < 0 ? Math.abs(billingDiff) : 0,
      credit: billingDiff > 0 ? billingDiff : 0,
      memo: `Billing balance: ${input.currentBilling} → ${input.newBilling}`,
      target_balance: 'billing',
    })
  }

  if (fundsDiff !== 0) {
    // Funds increase = credit liability (unit owes scout more); decrease = debit
    lines.push({
      journal_entry_id: input.journalEntryId,
      account_id: input.fundsLiabilityAccountId,
      scout_account_id: input.scoutAccountId,
      debit: fundsDiff < 0 ? Math.abs(fundsDiff) : 0,
      credit: fundsDiff > 0 ? fundsDiff : 0,
      memo: `Funds balance: ${input.currentFunds} → ${input.newFunds}`,
      target_balance: 'funds',
    })
  }

  const netDebit = roundToCents(
    lines.reduce((sum, line) => sum + line.debit - line.credit, 0)
  )
  if (netDebit !== 0) {
    lines.push({
      journal_entry_id: input.journalEntryId,
      account_id: input.openingBalanceAccountId,
      scout_account_id: null,
      debit: netDebit < 0 ? Math.abs(netDebit) : 0,
      credit: netDebit > 0 ? netDebit : 0,
      memo: 'Opening balance contra',
      target_balance: null,
    })
  }

  return lines
}
