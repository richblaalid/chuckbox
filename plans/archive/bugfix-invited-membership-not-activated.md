# Bugfix: Unit Creator Membership Stays "invited" After Login

## Problem

When a user creates a new unit through the onboarding flow without importing roster data:

1. Unit, profile, and membership are created (membership `status: "invited"`)
2. Supabase sends an invite email with a verification link
3. User clicks the invite link → Supabase's `/auth/v1/verify?type=invite` processes it
4. **Supabase redirects to `/auth/confirm` but the PKCE code exchange fails** because the invite link opens in a new browser context without the PKCE code verifier
5. The `verifyProvisioningToken()` call never executes, so membership stays `"invited"`
6. User signs in via magic link (which works), but the `provision_token` isn't in the magic link URL
7. Dashboard layout queries `unit_memberships` with `.eq('status', 'active')` → returns empty → "not assigned to any unit"

## Root Cause

Two compounding issues:

1. **PKCE + Invite incompatibility**: Supabase's invite flow uses PKCE, but the code verifier is stored in the browser session that initiated the request. Email links open in a new context without the verifier, so `exchangeCodeForSession()` fails. The fallback OTP verification in `auth/confirm` also fails for invite-type tokens.

2. **No fallback activation path**: If the provisioning token flow fails for any reason, there's no mechanism to activate the membership when the user eventually signs in successfully. The activation is tightly coupled to the `provision_token` query parameter being present in the URL.

## Fix Approach

Add an `activateProvisionedMemberships` server action that:
- Gets the current authenticated user
- Finds any unverified provisioning tokens matching their email
- Activates the corresponding memberships and marks tokens as verified

Call this from `auth/confirm` after any successful authentication, alongside the existing `tryAcceptInvites()` call. This handles the case regardless of which auth method succeeded.

**Files to modify:**
- `src/app/actions/onboarding.ts` — add `activateProvisionedMemberships` action
- `src/app/(auth)/auth/confirm/page.tsx` — call the new action after successful auth

## Risk Assessment

- **Low risk**: The new action only activates memberships where the authenticated user's email matches the provisioning token email, and the token hasn't already been verified
- **No breaking changes**: Existing flows continue to work; this is an additive fallback
- **Edge case**: If a user somehow has multiple pending provisioning tokens, all matching ones get activated (correct behavior)
