# CHUCK-9 — Repair Trial Balance (before/after)

One-time repair executed by `supabase/migrations/20260712000003_journal_balance_repair_and_constraint.sql` against the dev database (`feownmcpkfugkcivdoal`) on 2026-07-12. 64 unbalanced journal entries repaired (57 beginning-balance imports + 1 import reversal → `3000` contra; 5 reconciled card payments → `5600` fee debit; 1 fees-passed payment link → `5600` surcharge credit). After repair: **0 unbalanced entries** (202 total), both unit trial balances tie out. Prod has NOT been touched — the same migration needs explicit approval before any prod push.

## Before (2026-07-12, pre-repair)

```
== Unit 10000000-0000-4000-a000-000000000001 (seed unit) ==
1000  Bank Account - Checking              asset     D    1015.85  C       0.00  net     1015.85
1100  Accounts Receivable                  asset     D      50.00  C       0.00  net       50.00
1200  Scout Billing Receivable             asset     D    2208.00  C    1750.50  net      457.50
1210  Scout Funds Receivable               asset     D     712.50  C     552.50  net      160.00
2100  Accounts Payable                     liability D     148.32  C     916.22  net     -767.90
4000  Dues Income                          income    D       0.00  C     850.00  net     -850.00
4100  Camping Fees                         income    D      10.00  C    1400.50  net    -1390.50
4900  Other Income                         income    D     545.00  C       0.00  net      545.00
5600  Payment Processing Fees              expense   D      12.15  C       0.00  net       12.15
TOTAL debits 4701.82  credits 5469.72  OUT OF BALANCE by -767.90 ✗

== Unit a2727201-1af8-4607-9fb6-9116ec08613f (pilot copy) ==
1000  Bank Account - Checking              asset     D     310.20  C       0.00  net      310.20
1100  Accounts Receivable                  asset     D     150.00  C       0.00  net      150.00
1200  Scout Billing Receivable             asset     D     206.17  C     424.17  net     -218.00
1210  Scout Funds Receivable               asset     D     236.50  C      67.17  net      169.33
2100  Accounts Payable                     liability D      60.00  C   15426.06  net   -15366.06
4000  Dues Income                          income    D       0.00  C     150.00  net     -150.00
4100  Camping Fees                         income    D      14.00  C     139.00  net     -125.00
4900  Other Income                         income    D       0.00  C     142.88  net     -142.88
5600  Payment Processing Fees              expense   D       0.21  C       0.00  net        0.21
TOTAL debits 977.08  credits 16349.28  OUT OF BALANCE by -15372.20 ✗
```

## After (2026-07-12, post-repair, constraint active)

```
== Unit 10000000-0000-4000-a000-000000000001 (seed unit) ==
1000  Bank Account - Checking              asset     D    1015.85  C       0.00  net     1015.85
1100  Accounts Receivable                  asset     D      50.00  C       0.00  net       50.00
1200  Scout Billing Receivable             asset     D    2208.00  C    1750.50  net      457.50
1210  Scout Funds Receivable               asset     D     712.50  C     552.50  net      160.00
2100  Accounts Payable                     liability D     148.32  C     916.22  net     -767.90
3000  Opening Balance Equity               equity    D     916.22  C     148.32  net      767.90
4000  Dues Income                          income    D       0.00  C     850.00  net     -850.00
4100  Camping Fees                         income    D      10.00  C    1400.50  net    -1390.50
4900  Other Income                         income    D     545.00  C       0.00  net      545.00
5600  Payment Processing Fees              expense   D      12.15  C       0.00  net       12.15
TOTAL debits 5618.04  credits 5618.04  TIES OUT ✓

== Unit a2727201-1af8-4607-9fb6-9116ec08613f (pilot copy) ==
1000  Bank Account - Checking              asset     D     310.20  C       0.00  net      310.20
1100  Accounts Receivable                  asset     D     150.00  C       0.00  net      150.00
1200  Scout Billing Receivable             asset     D     206.17  C     424.17  net     -218.00
1210  Scout Funds Receivable               asset     D     236.50  C      67.17  net      169.33
2100  Accounts Payable                     liability D      60.00  C   15426.06  net   -15366.06
3000  Opening Balance Equity               equity    D   15426.06  C      60.00  net    15366.06
4000  Dues Income                          income    D       0.00  C     150.00  net     -150.00
4100  Camping Fees                         income    D      14.00  C     139.00  net     -125.00
4900  Other Income                         income    D       0.00  C     142.88  net     -142.88
5600  Payment Processing Fees              expense   D       6.77  C       0.42  net        6.35
TOTAL debits 16409.70  credits 16409.70  TIES OUT ✓
```

Note the approved artifact: Opening Balance Equity carries a debit (negative-equity) balance — scout liabilities/receivables were imported without the matching bank opening balance. It zeroes out once the treasurer books the real opening bank balance.

## Constraint smoke test (live, post-migration)

1. Entry-only insert committed OK (constraint tolerates lines written in a later transaction) ✓
2. Unbalanced single-line insert **rejected**: `Journal entry … is unbalanced: sum of debits must equal sum of credits` ✓
3. Balanced pair in one insert accepted ✓
4. Partial line delete (would unbalance the entry) **rejected** ✓
5. Full-entry delete (cascade removes all lines) accepted ✓
