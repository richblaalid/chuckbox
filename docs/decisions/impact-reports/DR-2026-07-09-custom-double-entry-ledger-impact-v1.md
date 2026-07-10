# Impact Report: Custom Double-Entry Ledger (not Medici) v1

**DR:** docs/decisions/DR-2026-07-09-custom-double-entry-ledger-v1.md
**Generated:** 2026-07-09

## Summary
- Files affected: 3
- ACs requiring updates: 0 (no feature tests.md files exist yet — doc system installed today)
- ACs requiring behavioral rewording: 0
- New ACs recommended: 4 (deferred — land when finance feature folders are grounded)
- Superseded DRs: 0 (first DR in the system)

## Conflicts
- None. `docs/tech.md` and `docs/testing.md` were written today from the same audit this DR cites; the strategic roadmap's Medici recommendation (`docs/Chuckbox_Strategic_Roadmap_v2_2.md` §5.2) is historical context, not a live doc under supersession rules — the divergence is already flagged in `docs/prd.md`.

## Stale References
- None found (`grep -ri medici docs/ src/` → only the roadmap's original recommendation and this DR).

## ACs Requiring Updates (by file)
- None — no `docs/features/*/tests.md` exist yet.

## New ACs Recommended (deferred until finance feature folders exist)
- **Journal balance invariant:** any recorded financial event produces a balanced journal entry; an unbalanced write is rejected, not stored. (DR obligation 1)
- **Atomic money movement:** a failed payment/void/transfer leaves no partial state observable anywhere in the app. (DR obligation 2)
- **No silent balance correction:** a funds debit exceeding available funds is rejected with an error, never truncated. (DR obligation 3)
- **Void reversal:** voiding a payment restores balances and charge states to their prior observable values. (existing spec 2026-05-25 encodes these — carry into tests.md when grounded)

## Downstream Doc Updates
- **docs/tech.md:** "Active DR index" — replace the `_none yet_` row with this DR; trim the candidate note (this candidate is now recorded).
- **docs/features/platform-foundation/architecture.md:** "Active DRs constraining this pseudo-feature" — reference this DR.
- **docs/testing.md:** "Money edge cases" section — cite the DR as the authority binding the invariants to the finance-integration-tests spec.
- **docs/schema.dbml / docs/plan.md:** N/A — these files do not exist in this project's doc skeleton.

## Superseded DRs
- None.
