# Ticket Implementation Plan: [TICKET-ID] — [Title]

**Generated:** YYYY-MM-DD
**Linear:** [TICKET-ID] — [url]
**Branch:** [linear-provided git branch name]
**Status:** Planned | Approved | In Progress | Verified | PR Open
**Affects Features:** [feature folder(s), or "cross-cutting" / "new feature"]
**Epic:** [parent issue ID / project name + goal, or "standalone — no epic"]

## Ticket Summary

[1–3 sentence restatement of what the ticket asks for, in our own terms.]

## Epic Context

[The epic's goal, where this ticket sits in it, and the scope boundary against sibling tickets — what this ticket owns vs. what a sibling owns. Note any sibling that established a pattern/contract this ticket must conform to, or that this ticket depends on but isn't built yet. Drop this section only if the ticket is genuinely standalone.]

- **Epic:** [ID/name — goal]
- **Sibling tickets:** [ID — status — one-line scope, for each relevant sibling]
- **This ticket's boundary:** [what's in scope here vs. owned by a sibling]

## Grounding Extract

Distilled signal from the ticket, classified. Drop empty sections.

- **Decisions implied** — [concrete choices the ticket commits us to]
- **New requirements** — [new capabilities/constraints]
- **Changed requirements** — [modifications to existing behavior]
- **Technical signals** — [stack/integration/perf constraints]
- **Design signals** — [UI/UX, screens affected]
- **Acceptance criteria** — [observable behaviors — see Verification Plan]

## Analysis Against Existing Docs

- **Relevant requirements/architecture:** [features/*/requirements.md, architecture.md sections that constrain this work]
- **Active DRs that apply:** [DR filenames the implementation must respect]
- **Conflicts detected:** [anything in the ticket that contradicts an active DR, requirement, or AC — REQUIRES human decision at the gate]
- **Decision-record needed?** [If the ticket introduces a meaningful choice between alternatives with consequences (per docs/CLAUDE.md classification), flag it here. Do NOT silently decide — surface at the gate; the user may want to run /decide first.]

## Task List

Tasks added to `docs/features/[feature]/tasks.md` (status "Not Started"), using that feature's ID prefix and next-available numbers.

| Task ID | Description | TDD? | Dependencies | Verification |
|---|---|---|---|---|
| [PREFIX-NNN] | [imperative description] | yes/no | [task IDs or "none"] | [build/smoke or AC reference] |

## Verification Plan (AC → observable check)

| # | Acceptance criterion | How it's verified |
|---|---|---|
| 1 | [AC restated as observable behavior] | [automated test name / functional smoke step in the running app] |

## Screenshot Plan

- **Route(s):** [e.g. `/finances/accounts/:id` — the page that shows the feature]
- **Login:** [which test-user role authenticates against local dev — see CLAUDE.md Test User Credentials]
- **What to capture:** [the state that demonstrates the feature working]

## Open Questions

- [Ambiguities to confirm at the gate, or to post back to the ticket for the requester]
