---
status: active
last_verified: 2026-04-29
---

# Multi-Unit Smoke Test Runbook

Manual end-to-end test for the multi-unit data layer. Run this against a dev environment whenever:

- Code touching `getCurrentMembership` or any of the migrated routes/actions changes
- Before flipping `MULTI_UNIT_CREATION=true` in production
- After major refactors of the auth or membership flow

The data layer is multi-unit-aware in production, but the UI is gated by `MULTI_UNIT_CREATION` (default `false`). This runbook exercises the data layer in dev with the flag on.

## Setup

```bash
# 1. Set the flag in .env.local (this is intentionally not committed)
echo 'NEXT_PUBLIC_FEATURE_MULTI_UNIT_CREATION=true' >> .env.local

# 2. Start with a clean dev database
npm run db:fresh

# 3. Start the dev server
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Test user (from `npm run db:fresh`): `richard.blaalid+admin@withcaldera.com` / `testpassword123`. This user is admin of one unit. The runbook walks you through making it multi-unit, then verifying every flow.

## Phase A — make the test user multi-unit

- [ ] Log in as `richard.blaalid+admin@withcaldera.com`
- [ ] Confirm sidebar **does** show a `UnitSwitcher` dropdown (the flag is on; the user has 1 unit, but the dropdown should still render with the option to create another)
- [ ] Click "Create another unit" (Settings page link, or the dropdown's "+ New Unit" affordance)
- [ ] Complete the `/create-unit` form for a second unit (different name, e.g., "Pack 9999")
- [ ] On completion, verify the dropdown now lists **two** units
- [ ] In the dropdown, switch between Unit A and Unit B and confirm the URL gains a `?unit=<id>` query param

If any of the above fails, **STOP** — Phase 2 of the original onboarding plan (in-app unit creation) may have regressed; that's separate from this refactor.

## Phase B — single-unit user behavior unchanged

- [ ] Open a private/incognito window
- [ ] Log in as `richard.blaalid+treasurer@withcaldera.com` (single-unit user)
- [ ] Confirm sidebar shows the **static unit logo**, not the dropdown (single-unit users see the same UI as before, regardless of flag)
- [ ] Walk every nav link and confirm pages render normally — exactly as before the refactor

## Phase C — page-level multi-unit verification

Back in your main window, multi-unit user. For each page below:

1. Switch to Unit A via the dropdown
2. Confirm the page shows Unit A's data
3. Switch to Unit B
4. Confirm the page shows Unit B's data (different scouts, different balances, etc.)
5. Manually edit the URL to use `?unit=<bogus>` and confirm the page falls back gracefully (does not crash; falls back to first membership)

Pages to verify:

- [ ] `/dashboard`
- [ ] `/roster`
- [ ] `/scouts/[id]` — pick a scout from each unit's roster
- [ ] `/adults/[id]` — pick an adult from each unit
- [ ] `/finances`
- [ ] `/finances/accounts`
- [ ] `/finances/accounts/[id]`
- [ ] `/finances/billing`
- [ ] `/finances/payments`
- [ ] `/finances/reports`
- [ ] `/expenses` (list)
- [ ] `/expenses/new`
- [ ] `/expenses/[id]` (open an existing expense)
- [ ] `/expenses/[id]/edit`
- [ ] `/advancement`
- [ ] `/advancement/bulk-entry`
- [ ] `/settings`
- [ ] `/settings/import/charges`
- [ ] `/settings/import/balances`
- [ ] `/setup` (only meaningful if a unit has `needs_setup: true`)
- [ ] `/profile` (no unit context — verify it renders)

## Phase D — mutation flows (resource-scoped auth)

Test that mutations operate on the correct unit and reject cross-unit attempts.

- [ ] **Create expense in Unit A**: switch to A, create a draft expense, save
- [ ] Switch to Unit B — that expense should NOT appear in `/expenses`
- [ ] Open a network panel and copy the expense's URL — manually navigate while in Unit B context
- [ ] Confirm the expense detail page either 404s or renders without write controls (the auth check should reject editing across units)
- [ ] **Approve flow**: as treasurer (single-unit user, log in via incognito), submit an expense; as multi-unit admin, approve it. Verify the approval lands in the correct unit's journal entries.
- [ ] **Delete draft**: create a draft expense in Unit A, switch to B, try to delete via direct API call (use browser dev tools network tab to grab the request). Should reject with 403/404.

## Phase E — body-validating routes

These routes take `unit_id` from the request body. They should authorize against THAT unit, not the user's "current" unit.

- [ ] **`/api/settings/payment-fees`** — log in as multi-unit admin, edit fees for Unit A. Confirm the update lands in Unit A only.
- [ ] **`/api/expenses/receipt` POST** — upload a receipt for an expense in Unit A. Confirm storage path includes Unit A's ID.
- [ ] **`/api/expenses/receipt` DELETE** — delete a receipt as the submitter. Confirm it works. Try as a non-submitter, non-admin user — confirm rejection.
- [ ] **`/api/expenses/extract`** — submit a receipt extract request with a unitId you don't belong to. Confirm 403.
- [ ] **`/api/collection/send-reminders`** — try POSTing with a `unitId` of a unit the user does not belong to. Confirm 403.
- [ ] **`/api/settings/unit-logo`** POST — upload a logo for Unit A as Unit A's admin. Confirm it works. Try same request body but switched to a unit where you're treasurer (not admin). Confirm 403.

## Phase F — third-party integrations

- [ ] **Plaid (sandbox)** — connect a bank to Unit A using `user_good` / `pass_good`. Switch to Unit B. Confirm bank not visible. Switch back to A — bank visible.
- [ ] **Square (test mode)** — connect Square to Unit A. Disconnect it (admin only). Try as treasurer — should reject.
- [ ] **Square OAuth callback** — initiate `/api/square/oauth/authorize` for Unit A. Manually edit the callback URL's `state` param to claim Unit B. Confirm rejection (the explicit `membership.unit_id === unitId` check should catch this).
- [ ] **Square payments** — process a test payment through Plaid sandbox or test card flow on a scout in Unit A. Verify journal entry has Unit A's `unit_id`.
- [ ] **Scoutbook sync** — start a sync in Unit A. Switch to B mid-sync. The sync should complete against A. Cancel a staged sync — verify session.unit_id check.
- [ ] **Extension token** — generate an extension token from Unit A. Confirm the returned `unitId` in the token is Unit A's. Switch to Unit B in the UI. Generate another token — confirm it's bound to Unit B.

## Phase G — server actions

- [ ] **Void billing record** (admin/treasurer only). Create a billing record in Unit A, void it. Confirm reversal journal entries land in Unit A.
- [ ] **Cost-share creation** (Phase 2 cost-sharing for an expense). Verify cost shares are scoped to the expense's unit.
- [ ] **`completeSetupWizard`** — run through `/setup` as a unit admin. Confirm the unit's `needs_setup` flag flips correctly.

## Phase H — regression guard

- [ ] In a temporary file, add this code:
  ```ts
  await supabase.from('unit_memberships').select('unit_id').eq('profile_id', 'x').single()
  ```
- [ ] Run `npm run lint`. Confirm it errors with `custom/no-single-on-unit-memberships`. Delete the temp file.

## Pass criteria

All boxes checked. No 500 errors in the dev server console. No "multiple rows returned" errors in browser console or server logs.

## Outcome

Record results inline (check boxes) and commit the runbook with the date in `last_verified`. If anything fails, file as a separate bug under `plans/bugfix-*.md` — do not flip the flag in production until all known multi-unit bugs are resolved.

After a clean smoke run, you have evidence that the data layer is production-safe for multi-unit. Whether to flip `MULTI_UNIT_CREATION=true` in production is a *product decision* (do you have users asking for it? is the unit-switcher UX polished?), not a refactor decision.
