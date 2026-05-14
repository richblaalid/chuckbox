---
status: draft
last_verified: 2026-05-13
---

# Parent Email Alignment + Branding

> **Status**: Parked future work. Captured during the line-item shipping (PR for `feat/billing-email-line-items`, May 2026) when the user flagged two related but out-of-scope items.
> Pick this up with the `superpowers:brainstorming` skill to resolve the open questions below, then promote to `approved` before writing a plan.

## Context

The 2026-05-13 line-item work added a "Bill Includes" section to `charge-notification.ts` (the "Send Billing Reminder" / "New Charge" email triggered from a billing record). That work explicitly scoped *out* the sibling email template `payment-reminder.ts`, which fires from the Collection flow (`/api/collection/send-reminders`) for overdue aggregate balances spanning potentially multiple billing records.

User feedback while reviewing the line-item work:

1. The scout balance reminder (`payment-reminder.ts`) should also include line items so parents have the same reference when receiving an overdue-balance reminder.
2. Branding inside the bill reminder emails is inconsistent — Chuckbox identity isn't as visible or polished as it should be.

The user grouped these into "a larger email alignment work plan." Both relate to parent-facing email quality and consistency.

## Goals

- Parents receiving an overdue-balance reminder (`payment-reminder.ts`) see a breakdown of the line items behind the balance they owe, not just a flat total.
- Both parent-facing email templates (`charge-notification.ts` and `payment-reminder.ts`) share a consistent Chuckbox visual identity — logo, brand colors, footer, tone.
- A treasurer reading both emails side-by-side recognizes them as the same product. Today they differ in header style, footer, color palette, and branding.

## Non-goals

- Other email templates (`expense-approved.ts`, `expense-rejected.ts`, `payment-request.ts`) are out of this spec unless brainstorming surfaces them as part of the same visual system.
- No changes to email send infrastructure (Resend, unsubscribe handling, deliverability tuning) unless explicitly required by branding choices.
- No changes to billing data model.

## Findings — what's inconsistent today

After PR #32 + PR #33 + the May 2026 line-item PR shipped, the two parent-facing emails diverge in several ways. Specific items to address (audit during brainstorming):

### `payment-reminder.ts` (overdue-balance reminder)

- **No line item detail.** The email shows only the aggregate `amountDue` and `daysOverdue`. A parent has no way to see what the balance covers.
- **Urgency-color theming.** Uses red/amber/blue based on days overdue, switching the entire box's accent color. The other template uses red consistently for the Charge Details box and forest green for CTAs.
- **No unit logo support.** `charge-notification.ts` accepts `unitLogoUrl`; this one does not.
- **CTA button is `#2563eb` blue.** The other template's CTA is `#166534` forest green.
- **Footer is one line.** The other template's footer is more substantive.

### `charge-notification.ts` (new charge / send-billing-reminder)

- Per-charge focused — has direct access to one record and now its line items (post-line-item PR).
- Uses forest green for CTAs, red for charge details, gray for neutral boxes. The shipped "Bill Includes" section uses `#f9fafb` neutral background.
- Supports `unitLogoUrl`.
- Footer mentions Chuckbox + unit contact.

### Shared concerns

- No project-wide design tokens for email — colors and font sizes are inline strings duplicated across templates. Drift is inevitable without a shared source.
- Plain-text fallbacks differ in indentation and section dividers between templates.
- No shared component / partial for header, footer, CTA, or amount-box. Each template hand-rolls its HTML.

## Decomposition (suggested)

This is likely too large for a single spec. Suggested split:

1. **Line items in `payment-reminder.ts`** — the part directly requested. Adds a "Bill Includes" section similar to the charge-notification template, but the data path is harder because the reminder aggregates across multiple billing records. Need to decide: per-record sections, or a single merged list?

2. **Email design system / shared partials** — extract header, footer, CTA, amount-box, line-item-box into a shared module so both templates pull from the same source. Define color/font tokens. Probably co-locate at `src/lib/email/components/` and import from each template.

3. **Branding pass on both templates** — apply the shared system, settle on Chuckbox's visual identity (logo placement, color palette, footer voice), update unit-logo support across both templates.

Brainstorming should decide whether to ship (1) alone first, or do (2) → (3) → (1) so the line-item addition uses the new system from the start. Or do them all in one big branch with feature flags. Trade-offs need user input.

## Open questions (for the next brainstorming session)

1. **Aggregation for `payment-reminder.ts` line items.** The reminder is sent for overdue *aggregate balance*, which can include multiple unpaid billing records. Options:
   - **(a)** List line items grouped by billing record: "From 'Summer Camp Deposit' (5/8): Tent $80, Food $100. From 'October Trip' (10/2): Bus $40." Most informative; verbose.
   - **(b)** Flat list combining all line items from all unpaid records: "Bill Includes: Tent $80, Food $100, Bus $40." Simpler; loses record context.
   - **(c)** Per-record section with full Bill Includes box per record (like 2+ stacked sections). Most thorough; longest email.
   - **(d)** Top N most recent / largest records, with "and N other items" rollover.

2. **Shared design tokens — where do they live?**
   - **(a)** A new `src/lib/email/tokens.ts` exporting color constants, font sizes, spacing scale.
   - **(b)** Inline in a shared `src/lib/email/theme.ts` with helper functions (`primaryCtaButton(text, href)` etc).
   - **(c)** Import from the existing `src/lib/tokens.ts` (if Tailwind tokens exist) — keep one source for app + email.

3. **Logo handling across templates.** Should `payment-reminder.ts` also accept `unitLogoUrl`? Should the absence of a logo fall back to a Chuckbox wordmark?

4. **Brand color palette.** Today: red (`#dc2626`), amber (`#d97706`), forest green (`#166534`), blue (`#2563eb`), neutral grays. Are all of these "Chuckbox brand colors," or should we settle on a tighter palette and revise away the outliers? Where in the codebase / design system is the canonical palette?

5. **Tone of voice.** Today both templates use a neutral, transactional voice. Should the user-facing copy be warmer? More Scout-specific? (Possibly out of scope but worth surfacing.)

6. **Email rendering test setup.** As the templates grow more complex with shared partials, do we need a snapshot-test or visual-regression strategy? Today the per-template unit tests just check for specific string fragments. That scales poorly with shared components.

## Adjacent work to track

- The line-item shipping branch (`feat/billing-email-line-items`, May 2026) established `parseLineItems`, the "Bill Includes" rendering pattern, `escapeHtml`, and the share-line denominator semantics. Any future email work that wants line-item detail should reuse this pattern (and probably move the helper to a shared location).
- The deferred specs `2026-05-12-payment-modal-charge-allocation-design.md` and `2026-05-12-void-delete-billing-ux-design.md` are separate work tracks — independent of email alignment.

## Files likely involved (when implementation lands)

- `src/lib/email/templates/payment-reminder.ts` — line items + branding
- `src/lib/email/templates/charge-notification.ts` — branding alignment (line items already shipped)
- Possibly `src/lib/email/templates/expense-approved.ts`, `expense-rejected.ts`, `payment-request.ts` (if branding scope expands)
- New: `src/lib/email/components/` or similar — shared partials
- New: `src/lib/email/tokens.ts` or `src/lib/email/theme.ts` — shared design tokens
- `src/app/api/collection/send-reminders/route.ts` — wire any new data needed for `payment-reminder.ts` line items
- Tests for each affected template
