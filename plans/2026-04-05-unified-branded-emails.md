# Unified Branded Email System

> **Status:** Draft
> **Created:** 2026-04-05
> **Author:** Claude

---

## 1. Requirements

### 1.1 Problem Statement

Chuckbox sends emails through two separate systems:
- **5 transactional email types** via Resend with full Chuckbox branding (charge notifications, payment reminders, payment requests, expense approved/rejected)
- **3 auth email types** via Supabase's built-in mailer with generic Supabase branding (invites, magic links, email change confirmations)

The invite email is the **first email a parent receives** from Chuckbox, and it arrives with Supabase's default template — no unit name, no role context, no Chuckbox branding. This creates a confusing and unprofessional first impression.

### 1.2 User Stories

- [ ] As a **parent**, I want my invite email to tell me which Scout unit I'm joining and what role I'll have, so I'm not confused by a generic email
- [ ] As a **parent**, I want every email from Chuckbox to look consistent and professional, so I trust the platform
- [ ] As a **user**, I want my magic link sign-in email to be clearly from Chuckbox, so I know it's not spam
- [ ] As a **unit admin**, I want the invite emails I send to represent my unit well, so parents take them seriously
- [ ] As a **user**, I want email change confirmations to be branded, so I recognize them as legitimate

### 1.3 Acceptance Criteria

- [ ] Invite emails include unit name, inviter name, and assigned role
- [ ] Magic link emails are Chuckbox-branded with consistent layout
- [ ] All auth emails send from `noreply@accounts.chuckbox.app`
- [ ] All auth emails use the same visual design system as existing transactional emails
- [ ] Email change confirmations route through Resend (via Custom SMTP at minimum)
- [ ] Existing auth flows (invite accept, magic link sign-in) continue to work unchanged
- [ ] No Supabase-branded emails reach end users

### 1.4 Out of Scope

- React Email or email templating framework migration (keep current HTML string templates)
- Email analytics/tracking (open rates, click rates)
- Email preference management / unsubscribe
- Refactoring all 5 existing transactional templates to shared base (separate task)
- Admin email preview/test functionality

### 1.5 Open Questions

| Question | Answer | Decided By |
|----------|--------|------------|
| Password reset emails? | N/A — app uses magic link auth only, no passwords | Richard |
| Sender address? | `noreply@accounts.chuckbox.app` | Richard |
| Include unit context in invites? | Yes — unit name, inviter name, role | Richard |
| Email change approach? | Custom SMTP for Phase 1, full custom flow Phase 2 | -- |

---

## 2. Technical Design

### 2.1 Approach: `admin.generateLink()` + Resend

**Replace Supabase's email sending with custom flows that generate auth links server-side and send branded emails via Resend.**

For **invite** and **magic link** emails, use `admin.generateLink()` which returns the auth verification URL without sending an email. Then send a branded email via Resend with the link embedded.

For **email change** confirmations (Phase 1), configure Supabase's Custom SMTP to route through Resend's SMTP server (`smtp.resend.com`). This ensures even Supabase-sent emails come from `noreply@accounts.chuckbox.app`. Customize the template in Supabase Dashboard for basic branding.

**Why this approach over alternatives:**

| Approach | Pros | Cons |
|----------|------|------|
| **`generateLink()` + Resend** (chosen) | Full template control, all code in Next.js, same template system, full context at send time | Must modify call sites |
| Send Email Hook (Edge Function) | Intercepts all emails centrally | Requires Deno edge function, new deploy surface, limited context (no unit name without DB query) |
| Custom SMTP only | Zero code changes | Limited template customization (Go template syntax), two template systems |

### 2.2 Database Changes

None required. All changes are in application code and Supabase dashboard configuration.

### 2.3 API/Server Actions

| Action | Purpose |
|--------|---------|
| `sendMagicLink(email)` | New server action: generates magic link via admin API, sends branded email via Resend |
| Modified `inviteUser()` | Replace `inviteUserByEmail()` with `generateLink({ type: 'invite' })` + Resend |
| Modified `resendInvite()` | Same replacement |
| Modified `inviteProfileToApp()` | Same replacement |
| Modified `provisionUnit()` | Same replacement |

### 2.4 Email Templates

| Template | Location | Purpose |
|----------|----------|---------|
| `email-base-layout.ts` | `src/lib/email/templates/` | Shared header/footer/styles for all emails |
| `auth-invite.ts` | `src/lib/email/templates/` | Branded invite with unit name, role, inviter |
| `auth-magic-link.ts` | `src/lib/email/templates/` | Branded magic link sign-in |

### 2.5 Architecture

**Current flow (Supabase sends):**
```
Login Page → signInWithOtp() → Supabase Auth → Supabase Mailer → User Inbox
                                                 (generic template)
```

**New flow (Resend sends):**
```
Login Page → sendMagicLink() server action → admin.generateLink() → Supabase Auth (link only)
                                           → Resend API → User Inbox
                                             (branded template)
```

**Invite flow change:**
```
Before: inviteUserByEmail(email) → Supabase creates user + sends generic email
After:  generateLink({ type: 'invite' }) → Supabase creates user (no email)
        → sendEmail() via Resend → branded email with unit context
```

**Auth confirmation flow (unchanged):**
```
User clicks link → /auth/v1/verify?token=...&type=...&redirect_to=...
                 → Supabase verifies → redirects to /auth/callback
                 → /auth/confirm page → exchanges code → dashboard
```

---

## 3. Implementation Tasks

### Phase 0: Foundation

#### 0.1 Shared Email Base Layout
- [ ] **0.1.1** Create shared email base layout helper (`emailBaseLayout`)
  - Files: `src/lib/email/templates/email-base-layout.ts`
  - Extracts common HTML structure: doctype, head, responsive meta, font stack, centered 600px table, header with optional logo, footer with "Sent via ChuckBox"
  - Exports `wrapInBaseLayout({ title, headerColor, headerIcon, headerText, unitName, bodyHtml, footerHtml }): string`
  - Test: Unit test verifying HTML output includes expected structure

- [ ] **0.1.2** Create shared plain text base layout helper
  - Files: `src/lib/email/templates/email-base-layout.ts` (add to same file)
  - Exports `wrapInBasePlainText({ headerText, bodyText, footerText }): string`
  - Test: Unit test verifying plain text output

#### 0.2 Supabase Custom SMTP Configuration (Manual)
- [ ] **0.2.1** Configure Supabase Custom SMTP in dashboard (DEV project)
  - Dashboard: Auth > SMTP Settings
  - Host: `smtp.resend.com`, Port: `465` (SSL), User: `resend`, Password: `RESEND_API_KEY`
  - Sender: `ChuckBox <noreply@accounts.chuckbox.app>`
  - Test: Trigger an email change in dev, verify it arrives from the correct sender

- [ ] **0.2.2** Customize email change template in Supabase Dashboard
  - Dashboard: Auth > Email Templates > "Change Email Address"
  - Add basic ChuckBox branding (logo, colors, footer) using Go template syntax
  - Test: Trigger email change, verify branded template

---

### Phase 1: Auth Email Templates & Helpers

#### 1.1 Email Templates
- [ ] **1.1.1** Create invite email template (`auth-invite.ts`)
  - Files: `src/lib/email/templates/auth-invite.ts`
  - Interface: `InviteEmailData { recipientName?, unitName, inviterName?, role, confirmUrl }`
  - Uses shared base layout
  - Content: "You've been invited to join [unitName]", role badge, inviter name, CTA button
  - Both HTML and plain text versions
  - Test: Unit test for template output with various data combinations

- [ ] **1.1.2** Create magic link email template (`auth-magic-link.ts`)
  - Files: `src/lib/email/templates/auth-magic-link.ts`
  - Interface: `MagicLinkEmailData { confirmUrl, expiresIn? }`
  - Uses shared base layout
  - Content: "Sign in to ChuckBox", CTA button, security note ("If you didn't request this...")
  - Both HTML and plain text versions
  - Test: Unit test for template output

#### 1.2 Auth Email Helpers
- [ ] **1.2.1** Create `sendAuthInviteEmail()` helper
  - Files: `src/lib/email/send-auth-emails.ts`
  - Uses `admin.generateLink({ type: 'invite', email, options: { redirectTo } })`
  - Generates branded email from `auth-invite.ts` template
  - Sends via `sendEmail()` from `resend.ts`
  - Returns `{ actionLink, userId }` for caller to use
  - Test: Unit test with mocked Supabase admin client and Resend

- [ ] **1.2.2** Create `sendAuthMagicLinkEmail()` helper
  - Files: `src/lib/email/send-auth-emails.ts` (same file)
  - Uses `admin.generateLink({ type: 'magiclink', email, options: { redirectTo } })`
  - Generates branded email from `auth-magic-link.ts` template
  - Sends via `sendEmail()`
  - Handles "user not found" gracefully (returns success without revealing non-existence)
  - Test: Unit test with mocked clients, including user-not-found case

#### 1.3 Replace Invite Call Sites
- [ ] **1.3.1** Replace invite in `inviteUser()` action
  - Files: `src/app/actions/users.ts`
  - Replace `admin.inviteUserByEmail()` with `sendAuthInviteEmail()`
  - Pass unit name (already fetched), inviter name (fetch from profile), role
  - Use returned userId to set auth user metadata if needed
  - Test: Unit test, manual test with real invite

- [ ] **1.3.2** Replace invite in `resendInvite()` action
  - Files: `src/app/actions/users.ts`
  - Same replacement pattern
  - Test: Unit test, manual test

- [ ] **1.3.3** Replace invite in `inviteProfileToApp()` action
  - Files: `src/app/actions/users.ts`
  - Same replacement pattern, uses profile data for recipient name
  - Test: Unit test, manual test

- [ ] **1.3.4** Replace invite in `provisionUnit()` action
  - Files: `src/app/actions/onboarding.ts`
  - Replace `admin.inviteUserByEmail()` with `sendAuthInviteEmail()`
  - Use admin name, unit name from onboarding data
  - Maintain `provision_token` in redirect URL
  - Test: Unit test, manual test of onboarding flow

#### 1.4 Replace Magic Link Login
- [ ] **1.4.1** Create `sendMagicLink` server action
  - Files: `src/app/actions/auth.ts` (new file)
  - Server action that accepts email, calls `sendAuthMagicLinkEmail()`
  - Returns `{ success: true }` regardless of whether user exists (security)
  - Rate limiting consideration: rely on Supabase's built-in rate limits
  - Test: Unit test with mocked helpers

- [ ] **1.4.2** Update login page to use server action
  - Files: `src/app/(auth)/login/page.tsx`
  - Replace client-side `supabase.auth.signInWithOtp()` with `sendMagicLink()` server action
  - Keep same UX: enter email → click "Send Magic Link" → success message
  - Handle loading/error states
  - Test: Manual test of full sign-in flow

- [ ] **1.4.3** Verify auth confirmation flow still works
  - Files: (no changes expected to `src/app/(auth)/auth/confirm/page.tsx`)
  - Test: End-to-end test of magic link click → callback → confirm → dashboard
  - Verify both hash-based and code-based confirmation paths work

---

<!-- MVP BOUNDARY - Everything above is required for MVP -->

### Phase 2: Enhancements (Post-MVP)

#### 2.1 Custom Email Change Flow
- [ ] **2.1.1** Create email change templates (current email + new email)
  - Files: `src/lib/email/templates/auth-email-change.ts`
  - Two templates: one for "confirm you want to change" (sent to old email), one for "confirm new email" (sent to new email)
  - Test: Unit tests

- [ ] **2.1.2** Create custom email change server action
  - Files: `src/app/actions/auth.ts`
  - Uses `admin.generateLink({ type: 'email_change_current' })` and `admin.generateLink({ type: 'email_change_new' })`
  - Sends both branded emails via Resend
  - Test: Unit test

- [ ] **2.1.3** Update profile page to use custom email change
  - Files: `src/components/settings/contact-form.tsx`, `src/app/actions/profile.ts`
  - Replace `supabase.auth.updateUser({ email })` with custom action
  - Test: Manual test of email change flow

#### 2.2 Refactor Existing Templates
- [ ] **2.2.1** Migrate existing transactional templates to shared base layout
  - Files: All 5 templates in `src/lib/email/templates/`
  - Refactor to use `wrapInBaseLayout()` instead of duplicated HTML
  - Test: Visual diff — emails should look identical before/after

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/lib/email/templates/email-base-layout.ts` | Shared HTML/plaintext email layout |
| `src/lib/email/templates/auth-invite.ts` | Branded invite email template |
| `src/lib/email/templates/auth-magic-link.ts` | Branded magic link email template |
| `src/lib/email/send-auth-emails.ts` | Auth email helpers (generateLink + Resend) |
| `src/app/actions/auth.ts` | Auth-related server actions (sendMagicLink) |
| `tests/unit/email-templates.test.ts` | Unit tests for new templates |
| `tests/unit/send-auth-emails.test.ts` | Unit tests for auth email helpers |

### Modified Files
| File | Changes |
|------|---------|
| `src/app/actions/users.ts` | Replace `inviteUserByEmail()` with `sendAuthInviteEmail()` in 3 functions |
| `src/app/actions/onboarding.ts` | Replace `inviteUserByEmail()` with `sendAuthInviteEmail()` in `provisionUnit()` |
| `src/app/(auth)/login/page.tsx` | Replace client-side `signInWithOtp()` with `sendMagicLink()` server action |

### Dashboard Configuration (Manual)
| Setting | Location |
|---------|----------|
| Custom SMTP | Supabase Dashboard > Auth > SMTP Settings |
| Email Change Template | Supabase Dashboard > Auth > Email Templates |

---

## 5. Testing Strategy

### Unit Tests
- [ ] `email-base-layout.ts` — HTML output includes doctype, meta, 600px table, footer
- [ ] `auth-invite.ts` — Template renders unit name, role, inviter, confirm URL
- [ ] `auth-invite.ts` — Handles missing optional fields (no inviter name, no recipient name)
- [ ] `auth-magic-link.ts` — Template renders confirm URL, security note
- [ ] `send-auth-emails.ts` — `sendAuthInviteEmail()` calls generateLink + sendEmail
- [ ] `send-auth-emails.ts` — `sendAuthMagicLinkEmail()` returns success even when user not found
- [ ] `auth.ts` action — `sendMagicLink()` calls helper and returns success

### Manual Testing
- [ ] Invite a new user → verify email arrives with unit name, role, Chuckbox branding
- [ ] Click invite link → verify auth confirmation flow completes
- [ ] Sign in via magic link → verify email arrives branded
- [ ] Click magic link → verify sign-in completes
- [ ] Resend an invite → verify branded email arrives
- [ ] Onboarding flow → verify provisioning invite is branded
- [ ] Change email in profile → verify confirmation email arrives from correct sender (SMTP)
- [ ] Try magic link with non-existent email → verify generic success message (no info leak)

---

## 6. Rollout Plan

### Dependencies
- Resend domain `accounts.chuckbox.app` already verified (confirmed)
- `RESEND_API_KEY` already configured in production
- Supabase Admin client already available in server actions

### Environment Variables
| Variable | Current Value | New Value | Notes |
|----------|---------------|-----------|-------|
| `EMAIL_FROM` | `Chuckbox <onboarding@resend.dev>` (dev) | `ChuckBox <noreply@accounts.chuckbox.app>` | Update in `.env.local` |

### Migration Steps
1. Deploy code changes (generateLink + Resend templates)
2. Configure Supabase Custom SMTP in **DEV** dashboard
3. Customize email change template in **DEV** dashboard
4. Test all flows in dev
5. Configure Supabase Custom SMTP in **PROD** dashboard (with explicit approval)
6. Customize email change template in **PROD** dashboard
7. Deploy to production

### Verification
- Send test invite in production → verify branded email
- Sign in via magic link in production → verify branded email
- Check Resend dashboard for delivery metrics

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 | 4 | 0 | Not Started |
| Phase 1 | 9 | 0 | Not Started |
| Phase 2 | 4 | 0 | Not Started |

---

## 8. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| | | | |

---

## Approval

- [ ] Requirements reviewed by: _____
- [ ] Technical design reviewed by: _____
- [ ] Ready for implementation
